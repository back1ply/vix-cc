// Tree-sitter minifier test fixture: C# Worker Pool
// Features: records, pattern matching, async/await, LINQ, delegates, tuples,
// nullable refs, using declarations, generics, init setters, interpolation,
// extension methods, lambdas, default interface impl, top-level statements,
// static classes/methods, enums, try/catch/finally, lock, ternary
using System;using System.Collections.Concurrent;using System.Collections.Generic;using System.Linq;using System.Threading;using System.Threading.Tasks;// --- Top-level statements (must precede type declarations) ---
var pool=new WorkerPool<string>{MaxConcurrency=4,PoolName="MainPool"};pool.OnTaskCompleted+=(wid,item)=>Console.WriteLine($"[event] {wid} finished {item.Id}");var work=new WorkItem("job-1",TaskPriority.High,async ct=>{await Task.Delay(10,ct);return"done"as object;});// Using declaration
using var cts=new CancellationTokenSource();var result=await pool.SubmitAsync(work);var(pend,done,err)=pool.Snapshot();Console.WriteLine($"Snapshot: pending={pend}, done={done}, errors={err}");var stats=pool.GetStats();Console.WriteLine(stats.Summary);Console.WriteLine(Diagnostics.Classify(stats));Console.WriteLine(pool.Describe());/*
 * Enums, records, and core types for the worker pool.
 * These are used throughout the pool infrastructure.
 */
enum WorkerState{Idle,Busy,Draining,Stopped}enum TaskPriority{Low=0,Normal=5,High=10,Critical=20}
// --- Records ---
record class WorkItem(string Id,TaskPriority Priority,Func<CancellationToken,Task<object?>>Execute){public DateTime EnqueuedAt{get;init;}=DateTime.UtcNow;}record struct WorkerStats(int Completed,int Failed,double AvgLatencyMs){public string Summary=>$"done={Completed}, failed={Failed}, avg={AvgLatencyMs.ToString("F2")}ms";}
// --- Interface with default implementation ---
interface IWorkerPool<T>where T:class{Task<T?>SubmitAsync(WorkItem item);WorkerStats GetStats();string Describe()=>$"Pool<{typeof(T).Name}> with {GetStats().Completed} completed";}
// --- Delegate and event ---
delegate void PoolEvent(string workerId,WorkItem item);/// <summary>
/// Generic worker pool that processes <see cref="WorkItem"/> instances concurrently.
/// </summary>
class WorkerPool<T>:IWorkerPool<T>where T:class{private readonly ConcurrentQueue<WorkItem>_queue=new();private readonly object _lock=new();private int _completed;private int _failed;private double _totalLatency;public event PoolEvent?OnTaskCompleted;public event PoolEvent?OnTaskFailed;// Property with init setter
public int MaxConcurrency{get;init;}=Environment.ProcessorCount;public string?PoolName{get;init;}public void Enqueue(WorkItem item){_queue.Enqueue(item);}
// Async/await with Task
public async Task<T?>SubmitAsync(WorkItem item){Enqueue(item);using var cts=new CancellationTokenSource(TimeSpan.FromSeconds(30));// Try/catch/finally
try{var start=DateTime.UtcNow;var result=await item.Execute(cts.Token);// Lock statement
lock(_lock){_completed++;_totalLatency+=(DateTime.UtcNow-start).TotalMilliseconds;}OnTaskCompleted?.Invoke(PoolName??"default",item);// Pattern matching: switch expression with property & relational patterns
var logLevel=item.Priority switch{TaskPriority.Critical=>"CRIT",TaskPriority.High=>"WARN",TaskPriority p when(int)p>=3=>"INFO",_=>"DEBUG"};Console.WriteLine($"[{logLevel}] Task {item.Id} completed");return result as T;}catch(OperationCanceledException){lock(_lock){_failed++;}OnTaskFailed?.Invoke(PoolName??"unknown",item);return null;}catch(Exception ex){lock(_lock){_failed++;}Console.WriteLine($"Error in task {item.Id}: {ex.Message}");return null;}finally{Console.WriteLine($"Task {item.Id} processing finished");}}
// Tuples and deconstruction
public(int pending,int done,int errors)Snapshot(){lock(_lock){return(_queue.Count,_completed,_failed);}}public WorkerStats GetStats(){lock(_lock){
// Ternary expression
var avg=_completed>0?_totalLatency/_completed:0.0;return new WorkerStats(_completed,_failed,avg);}}
// LINQ query
public List<WorkItem>DrainHighPriority(){var items=new List<WorkItem>();while(_queue.TryDequeue(out var item))items.Add(item);var highPri=from w in items where w.Priority>=TaskPriority.High orderby w.EnqueuedAt select w;return highPri.ToList();}}
// --- Static class with extension methods ---
static class WorkerPoolExtensions{public static string Describe<T>(this WorkerPool<T>pool)where T:class{var(pending,done,errors)=pool.Snapshot();return$"Pending={pending}, Done={done}, Errors={errors}";}
// Lambda expression as parameter
public static async Task<List<T?>>SubmitBatch<T>(this WorkerPool<T>pool,IEnumerable<WorkItem>items)where T:class{var tasks=items.Select(i=>pool.SubmitAsync(i));var results=await Task.WhenAll(tasks);return results.ToList();}}
// --- Pattern matching helper ---
static class Diagnostics{public static string Classify(WorkerStats stats)=>stats switch{{Failed:0,Completed:>100}=>"Healthy-HighThroughput",{Failed:0}=>"Healthy",{Failed:var f,Completed:var c}when f>c=>"Degraded",_=>"Unknown"};// Nullable reference types, null-conditional, null-coalescing
public static string SafeName(WorkerPool<object>?pool){return pool?.PoolName?.ToUpperInvariant()??"UNNAMED";}}
