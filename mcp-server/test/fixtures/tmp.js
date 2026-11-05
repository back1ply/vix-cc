// Worker Pool - JavaScript Tree-Sitter Minifier Test Fixture

/* Pool status constants used throughout the module
   to track worker and pool lifecycle states. */
const POOL_STATUS = Object.freeze({
  IDLE: Symbol("idle"),
  BUSY: Symbol("busy"),
  DRAINING: Symbol("draining"),
  SHUTDOWN: Symbol("shutdown"),
});

const [DEFAULT_MIN, DEFAULT_MAX, ...EXTRA_LIMITS] = [2, 8, 16, 32];

const DEFAULT_OPTS = Object.freeze({
  minWorkers: DEFAULT_MIN,
  maxWorkers: DEFAULT_MAX,
  idleTimeout: EXTRA_LIMITS?.[0] ?? 30000,
  retryLimit: EXTRA_LIMITS?.[1] ?? 3,
});

const poolTag = (strings, ...values) =>
  `[WorkerPool:${values.map((v) => String(v)).join(":")}] ${strings.at(-1)}`;

const computedKey = "task";
const taskRegistry = {
  [computedKey + "Count"]: 0,
  [computedKey + "Log"]: [],
  [`${computedKey}Errors`]: [],
};

/**
 * Represents a unit of work to be executed by a worker.
 * Tasks are prioritized and tracked by creation time.
 */
class Task {
  #id;
  #fn;
  #priority;
  #createdAt;

  constructor(id, fn, priority = 0) {
    this.#id = id;
    this.#fn = fn;
    this.#priority = priority;
    this.#createdAt = Date.now();
  }

  get id() {
    return this.#id;
  }
  get priority() {
    return this.#priority;
  }
  get age() {
    return Date.now() - this.#createdAt;
  }

  async execute(...args) {
    return this.#fn(...args);
  }
}

class Worker {
  #id;
  #status;
  #taskCount = 0;
  #metadata;

  static #instanceCount = 0;
  static totalCompleted = 0;

  static resetCounters() {
    Worker.#instanceCount = 0;
    Worker.totalCompleted = 0;
  }

  constructor(id) {
    this.#id = id;
    this.#status = POOL_STATUS.IDLE;
    this.#metadata = new WeakMap();
    Worker.#instanceCount++;
  }

  get id() {
    return this.#id;
  }
  get status() {
    return this.#status;
  }
  get taskCount() {
    return this.#taskCount;
  }

  set status(newStatus) {
    this.#status = newStatus;
  }

  attachMeta(key, value) {
    this.#metadata.set(key, value);
  }

  getMeta(key) {
    return this.#metadata.get(key);
  }

  async run(task) {
    this.#status = POOL_STATUS.BUSY;
    try {
      const result = await task.execute(this.#id);
      this.#taskCount++;
      Worker.totalCompleted++;
      return { workerId: this.#id, taskId: task.id, result };
    } catch (err) {
      throw new Error(`Worker ${this.#id} failed on task ${task.id}: ${err.message}`);
    } finally {
      this.#status = POOL_STATUS.IDLE;
    }
  }
}

class WorkerPool extends Worker {
  #workers = [];
  #queue = [];
  #status;
  #opts;

  constructor(opts = {}) {
    super("pool-controller");
    const { minWorkers, maxWorkers, ...rest } = { ...DEFAULT_OPTS, ...opts };
    this.#opts = { minWorkers, maxWorkers, ...rest };
    this.#status = POOL_STATUS.IDLE;

    for (let i = 0; i < minWorkers; i++) {
      this.#workers.push(new Worker(`w-${i}`));
    }
  }

  get size() {
    return this.#workers.length;
  }
  get pending() {
    return this.#queue.length;
  }

  #findIdle() {
    return this.#workers.find((w) => w.status === POOL_STATUS.IDLE) ?? null;
  }

  #canScale() {
    return this.#workers.length < this.#opts.maxWorkers;
  }

  enqueue(task) {
    this.#queue.push(task);
    this.#queue.sort((a, b) => b.priority - a.priority);
  }

  async dispatch() {
    const results = [];
    const errors = [];

    for (const task of this.#queue) {
      let worker = this.#findIdle();
      if (!worker && this.#canScale()) {
        worker = new Worker(`w-${this.#workers.length}`);
        this.#workers.push(worker);
      }
      if (!worker) continue;

      try {
        const r = await worker.run(task);
        results.push(r);
      } catch (err) {
        errors.push(err);
      }
    }

    this.#queue = this.#queue.filter(
      (t) => !results.some((r) => r.taskId === t.id)
    );

    return { results, errors };
  }

  async dispatchAll() {
    this.#status = POOL_STATUS.BUSY;
    const batches = [];

    while (this.#queue.length > 0) {
      const idleWorkers = this.#workers.filter(
        (w) => w.status === POOL_STATUS.IDLE
      );
      const batch = this.#queue.splice(0, idleWorkers.length);

      const promises = batch.map((task, i) => idleWorkers[i].run(task));
      batches.push(Promise.all(promises));
    }

    const allResults = (await Promise.all(batches)).flat();
    this.#status = POOL_STATUS.IDLE;
    return allResults;
  }

  *iterateWorkers() {
    for (const worker of this.#workers) {
      yield { id: worker.id, status: worker.status, tasks: worker.taskCount };
    }
  }

  stats() {
    const workerStats = [...this.iterateWorkers()];
    const idle = workerStats.filter((w) => w.status === POOL_STATUS.IDLE);
    const busy = workerStats.filter((w) => w.status === POOL_STATUS.BUSY);
    const totalTasks = workerStats.reduce((sum, w) => sum + w.tasks, 0);

    const summary = workerStats.map((w) =>
      w.tasks > 0 ? `${w.id}(active)` : `${w.id}(idle)`
    );

    return {
      total: workerStats.length,
      idle: idle.length,
      busy: busy.length,
      totalTasks,
      pending: this.pending,
      summary,
    };
  }

  async shutdown() {
    this.#status = POOL_STATUS.DRAINING;
    if (this.#queue.length > 0) {
      await this.dispatchAll();
    }
    this.#status = POOL_STATUS.SHUTDOWN;
    const msg = poolTag`pool ${this.size} shut down`;
    this.#workers = [];
    return msg;
  }
}

async function runDemo() {
  const pool = new WorkerPool({ minWorkers: 3, maxWorkers: 6 });

  const tasks = Array.from({ length: 10 }, (_, i) => {
    const priority = i % 3 === 0 ? 10 : i % 2 === 0 ? 5 : 1;
    return new Task(`t-${i}`, async (workerId) => {
      const delay = Math.floor(Math.random() * 100);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return `${workerId} completed t-${i} in ${delay}ms`;
    }, priority);
  });

  for (const task of tasks) {
    pool.enqueue(task);
  }

  const results = await pool.dispatchAll();

  const successful = results
    .filter((r) => r.result != null)
    .map((r) => r.result);

  const grouped = Object.entries(
    results.reduce((acc, r) => {
      const key = r.workerId;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {})
  );

  const flatIds = [results.map((r) => r.taskId)].flat();

  const stats = pool.stats();
  const label = stats.idle > 0
    ? poolTag`${stats.idle} workers idle`
    : poolTag`${stats.busy} workers busy`;

  const shutdownMsg = await pool.shutdown();
  return { successful, grouped, flatIds, label, shutdownMsg };
}

export { WorkerPool, Worker, Task, POOL_STATUS, runDemo };
