/* outer comment /* nested inner comment */ end of outer */
import Foundation

// MARK: - Enums
enum TaskPriority: Int, CaseIterable {
    case low = 0, medium = 1, high = 2, critical = 3
}

enum TaskResult {
    case success(output: String)
    case failure(error: Error, retryable: Bool)
    case cancelled(reason: String?)
}

// MARK: - Protocols
protocol Worker: AnyObject {
    associatedtype Input
    associatedtype Output
    var id: String { get }
    var isIdle: Bool { get }
    func execute(_ input: Input) -> Result<Output, Error>
    func cancel()
}

/**
 Provides the next available task from an internal queue.
 Conforming types manage their own ordering strategy.
 */
protocol TaskProvider {
    func nextTask() -> WorkItem?
    func taskCount() -> Int
}

extension TaskProvider {
    func hasWork() -> Bool { return taskCount() > 0 }
    func statusLabel() -> String {
        let count = taskCount()
        return count > 0 ? "active (\(count) pending)" : "idle"
    }
}

// MARK: - WorkItem
struct WorkItem {
    let id: String
    let payload: Any
    let priority: TaskPriority
    let createdAt: Date
    var description: String {
        return "WorkItem(\(id), priority=\(priority.rawValue))"
    }
}

// MARK: - WorkerStats
struct WorkerStats {
    var tasksCompleted: Int = 0
    var tasksFailed: Int = 0
    var totalTime: TimeInterval = 0
    var successRate: Double {
        get {
            let total = tasksCompleted + tasksFailed
            return total > 0 ? Double(tasksCompleted) / Double(total) : 0.0
        }
        set {
            tasksCompleted = Int(newValue * 100)
            tasksFailed = Int((1.0 - newValue) * 100)
        }
    }
    func summary() -> (completed: Int, failed: Int, rate: Double) {
        return (tasksCompleted, tasksFailed, successRate)
    }
}

// MARK: - GenericWorker
class GenericWorker<T>: Worker where T: Codable {
    typealias Input = T
    typealias Output = String
    let id: String
    private let lock = NSLock()
    private var _isIdle: Bool = true
    var isIdle: Bool {
        lock.lock()
        defer { lock.unlock() }
        return _isIdle
    }
    private(set) var stats: WorkerStats = WorkerStats() {
        willSet {
            let tag = stats.successRate > 0.9 ? "healthy" : "degraded"
            log("Stats changing for \(id), was \(tag)")
        }
        didSet {
            log("Stats updated for \(id): rate=\(stats.successRate)")
        }
    }
    lazy var debugLabel: String = {
        return "Worker[\(self.id)]@\(Date().timeIntervalSince1970)"
    }()
    static var defaultTimeout: TimeInterval { return 30.0 }
    static func create(id: String) -> GenericWorker<T> {
        return GenericWorker<T>(id: id)
    }
    init(id: String) { self.id = id }

    /// Encodes the input as JSON and returns a summary of the processed payload.
    func execute(_ input: T) -> Result<String, Error> {
        lock.lock()
        _isIdle = false
        lock.unlock()
        defer {
            lock.lock()
            _isIdle = true
            lock.unlock()
        }
        let encoder = JSONEncoder()
        do {
            let data = try encoder.encode(input)
            guard let json = String(data: data, encoding: .utf8) else {
                stats.tasksFailed += 1
                return .failure(NSError(domain: "WorkerPool", code: -1))
            }
            stats.tasksCompleted += 1
            let label = json.count > 100 ? "large" : "small"
            return .success("Processed \(label) payload: \(json.prefix(50))")
        } catch {
            stats.tasksFailed += 1
            return .failure(error)
        }
    }
    func cancel() { log("Worker \(id) cancelled") }
    fileprivate func log(_ message: String) { print("[\(id)] \(message)") }
}

// MARK: - WorkerPool
public class WorkerPool<T: Codable>: TaskProvider {
    private var workers: [GenericWorker<T>] = []
    private var queue: [WorkItem] = []
    private let poolLock = NSLock()
    private let dispatchQueue = DispatchQueue(label: "com.pool.work", attributes: .concurrent)
    private let maxWorkers: Int
    private var _name: String = "default"
    public var name: String {
        get { return _name }
        set { _name = newValue.isEmpty ? "unnamed" : newValue }
    }
    static var maxPoolSize: Int { return 64 }
    lazy var welcomeMessage: String = {
        let msg = """
            WorkerPool "\(self.name)" initialized.
            Max workers: \(self.maxWorkers)
            Ready to process tasks.
            """
        return msg
    }()

    public init(name: String, maxWorkers: Int) {
        self.maxWorkers = maxWorkers > WorkerPool.maxPoolSize ? WorkerPool.maxPoolSize : maxWorkers
        self._name = name
    }
    subscript(index: Int) -> GenericWorker<T>? {
        guard index >= 0, index < workers.count else { return nil }
        return workers[index]
    }
    subscript(workerId id: String) -> GenericWorker<T>? {
        return workers.first { $0.id == id }
    }
    func nextTask() -> WorkItem? {
        poolLock.lock()
        defer { poolLock.unlock() }
        return queue.isEmpty ? nil : queue.removeFirst()
    }
    func taskCount() -> Int {
        poolLock.lock()
        defer { poolLock.unlock() }
        return queue.count
    }
    public func addWorker(_ worker: GenericWorker<T>) {
        poolLock.lock()
        defer { poolLock.unlock() }
        guard workers.count < maxWorkers else { return }
        workers.append(worker)
    }
    public func enqueue(_ item: WorkItem) {
        poolLock.lock()
        defer { poolLock.unlock() }
        queue.append(item)
        queue.sort { $0.priority.rawValue > $1.priority.rawValue }
    }
    public func processAll(completion: @escaping ([(String, Result<String, Error>)]) -> Void) {
        let group = DispatchGroup()
        var results: [(String, Result<String, Error>)] = []
        let resultsLock = NSLock()
        while let task = nextTask() {
            guard let worker = findIdleWorker() else { continue }
            group.enter()
            dispatchQueue.async { [weak self] in
                guard let self = self else {
                    group.leave()
                    return
                }
                let payload = task.payload as? T
                let input: T = payload ?? ("" as! T)
                let result = worker.execute(input)
                let tag = self.resultTag(for: result)
                self.logResult(
                    taskId: task.id,
                    status: tag != nil ? "done" : "unknown"
                )
                resultsLock.lock()
                results.append((task.id, result))
                resultsLock.unlock()
                group.leave()
            }
        }
        group.notify(queue: .main) { completion(results) }
    }
    private func findIdleWorker() -> GenericWorker<T>? {
        return workers.first { $0.isIdle }
    }
    private func resultTag(for result: Result<String, Error>) -> String? {
        switch result {
        case .success(let output):
            return output.isEmpty ? nil : "ok"
        case .failure:
            return "error"
        }
    }
    private func logResult(taskId: String, status: String) {
        let level = status == "error" ? "WARN" : "INFO"
        print("[\(level)] pool=\(name) task=\(taskId) status=\(status)")
    }
}

/* Manages a registry of heterogeneous WorkerPool instances keyed by name. */
// MARK: - PoolManager
class PoolManager {
    private var pools: [String: Any] = [:]
    func register<T: Codable>(pool: WorkerPool<T>, forKey key: String) {
        pools[key] = pool
    }
    func pool<T: Codable>(forKey key: String, as type: T.Type) -> WorkerPool<T>? {
        return pools[key] as? WorkerPool<T>
    }
    func inspect(key: String) -> String {
        guard let obj = pools[key] else { return "not found" }
        if let stringPool = obj as? WorkerPool<String> {
            return "StringPool(workers=\(stringPool.taskCount()))"
        } else if obj is WorkerPool<Int> {
            return "IntPool"
        } else {
            return "UnknownPool"
        }
    }
}

// MARK: - Helper Functions
func classifyPriority(_ item: WorkItem) -> String {
    switch item.priority {
    case .low: return "background"
    case .medium where item.id.hasPrefix("batch"): return "batch-medium"
    case .medium: return "standard"
    case .high, .critical:
        return item.priority == .critical ? "URGENT" : "high"
    }
}

func describePriorities() -> String {
    return TaskPriority.allCases.map { p -> String in
        let tag = p.rawValue >= 2 ? "important" : "normal"
        return "\(p): \(tag)"
    }.joined(separator: ", ")
}

func processResult(_ result: TaskResult, verbose: Bool) -> String {
    switch result {
    case .success(let output): return verbose ? "OK: \(output)" : "OK"
    case .failure(let error, let retryable):
        return "FAIL(\(error.localizedDescription)) - \(retryable ? "will retry" : "giving up")"
    case .cancelled(let reason): return "CANCELLED: \(reason ?? "no reason")"
    }
}

func formatWorkerInfo<W: Worker>(worker: W, verbose: Bool) -> String where W.Output == String {
    guard !worker.id.isEmpty else { return "<anonymous>" }
    let idleTag = worker.isIdle ? "idle" : "busy"
    let detail = verbose ? " [\(idleTag)]" : ""
    return "\(worker.id)\(detail)"
}

func runWithTimeout<T>(seconds: TimeInterval, fallback: T, work: () throws -> T) -> T {
    do { return try work() } catch { return fallback }
}

func batchProcess<T: Codable>(
    items: [T],
    using pool: WorkerPool<T>,
    transform: (T) -> WorkItem,
    done: @escaping (Int) -> Void
) {
    items.map(transform).forEach { pool.enqueue($0) }
    pool.processAll { results in
        let succeeded = results.filter { _, r in
            if case .success = r { return true }
            return false
        }.count
        done(succeeded)
    }
}

// MARK: - Demo
func demo() {
    let pool = WorkerPool<String>(name: "main", maxWorkers: 4)
    for i in 0..<4 {
        let w = GenericWorker<String>(id: "w-\(i)")
        pool.addWorker(w)
    }
    let priorities = TaskPriority.allCases
    for (index, priority) in priorities.enumerated() {
        let item = WorkItem(
            id: "task-\(index)",
            payload: "job-\(index)",
            priority: priority,
            createdAt: Date()
        )
        pool.enqueue(item)
    }
    // Ternary in function argument
    print(formatWorkerInfo(
        worker: pool[0]!,
        verbose: pool.taskCount() > 2 ? true : false
    ))
    // Trailing closure
    pool.processAll { results in
        let summary = results.isEmpty ? "no results" : "\(results.count) tasks done"
        print(summary)
    }
    // Optional chaining + nil coalescing
    let worker = pool[workerId: "w-0"]
    let label = worker?.debugLabel ?? "no worker"
    let status = worker?.isIdle != true ? "working" : "free"
    print("\(label) is \(status)")
    // Ternary inside string interpolation
    let count = pool.taskCount()
    print("Queue: \(count > 0 ? "\(count) pending" : "empty")")
    // Manager with type casting
    let manager = PoolManager()
    manager.register(pool: pool, forKey: "main")
    let retrieved = manager.pool(forKey: "main", as: String.self)
    let desc = retrieved != nil ? manager.inspect(key: "main") : "missing"
    print(desc)
    // Multi-line string
    let report = """
        Pool Report
        Name: \(pool.name)
        Tasks: \(count)
        Status: \(pool.hasWork() ? "active" : "idle")
        """
    print(report)
}
