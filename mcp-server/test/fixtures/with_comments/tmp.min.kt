package workerpool;
import kotlinx.coroutines.*
import java.util.concurrent.atomic.AtomicInteger;
import kotlin.reflect.KClass;
/* Utility enums and type aliases for the worker pool.
   These provide strongly-typed identifiers and callbacks. */
/**
 * Priority levels for tasks submitted to the worker pool.
 * @param level numeric priority used for sorting
 * @param label human-readable name for display
 * @return the enum constant matching the given level
 */
// 14. Enum classes with properties;
enum class TaskPriority(val level:Int,val label:String){
LOW(0,"low"){override fun icon()="."},
MEDIUM(5,"medium"){override fun icon()="*"},
HIGH(10,"high"){override fun icon()="!"},
CRITICAL(20,"critical"){override fun icon()="!!!"};
abstract fun icon():String;
fun display()=label+"("+icon()+")"
};
// 15. Type aliases;
typealias TaskId=Long;
typealias TaskHandler=suspend(Task)->TaskResult;
typealias WorkerFactory=(Int)->Worker;
// 2. Sealed classes / sealed interfaces;
sealed interface TaskResult{
val taskId:TaskId;
data class Success(override val taskId:TaskId,val output:String):TaskResult;
data class Failure(override val taskId:TaskId,val error:Throwable):TaskResult;
data class Retry(override val taskId:TaskId,val attempt:Int,val maxAttempts:Int):TaskResult
};
// 1. Data classes;
data class Task(
val id:TaskId,
val name:String,
val priority:TaskPriority,
val payload:Map<String,Any ? > =emptyMap(),
val timeoutMs:Long=5000L
);
data class PoolStats(
val totalTasks:Int,
val completed:Int,
val failed:Int,
val activeWorkers:Int
);
// 2. Sealed class;
sealed class PoolEvent{
data class TaskSubmitted(val task:Task):PoolEvent();
data class TaskCompleted(val result:TaskResult):PoolEvent();
data class WorkerStateChange(val workerId:Int,val running:Boolean):PoolEvent();
object PoolShutdown:PoolEvent()
};
// 10. Object declaration (singleton);
object WorkerIdGenerator{
private val counter=AtomicInteger(0);
fun next():Int=counter.incrementAndGet();
fun reset(){counter.set(0)}
};
// 6. Delegation (by keyword);
interface Logger{
fun log(message:String);
fun error(message:String,throwable:Throwable ? =null)
};
class ConsoleLogger(private val prefix:String):Logger{
override fun log(message:String)=println("["+prefix+"] "+message);
override fun error(message:String,throwable:Throwable?){
System.err.println("["+prefix+"] ERROR: "+message);
throwable?.printStackTrace(System.err)
}
};
class Worker(
val id:Int,
private val handler:TaskHandler,
loggerImpl:Logger=ConsoleLogger("Worker-"+id)
):Logger by loggerImpl{
// 18. Lazy properties;
val displayName:String by lazy{"Worker-#"+id+"["+Thread.currentThread().name+"]"};
// 13. Null safety (?., ?:, !!, let, also, apply, run);
private var currentTask:Task ? =null;
suspend fun execute(task:Task):TaskResult{
currentTask=task;
return try{
val name=currentTask?.name?:"unknown";
log(displayName+" processing: "+name);
currentTask?.let{t->
t.also{log("Task "+it.id+" payload size: "+it.payload.size)};
handler(t)
}?:TaskResult.Failure(task.id,IllegalStateException("Task became null"))
}catch(e:Exception){
// 20. Try/catch as expression;
val msg=runCatching{e.message!!}.getOrElse{"No message"};
error("Failed: "+msg,e);
TaskResult.Failure(task.id,e)
}finally{
currentTask=null
}
};
fun status():String=currentTask.run{
this?.let{"busy with "+it.name}?:"idle"
}
};
// 17. Higher-order functions + 11. Lambda with receiver;
fun buildTaskList(block:MutableList<Task > .()->Unit):List<Task>{
return mutableListOf<Task>().apply(block)
};
// 3. Extension functions;
fun List<Task > .sortedByPriority():List<Task > =
sortedByDescending{it.priority.level};
fun Task.describe():String=
// 12. String templates;
"Task(id="+id+", name='"+name+"', priority="+priority.display()+", timeout="+timeoutMs+"ms)";
fun TaskResult.isTerminal():Boolean=when(this){
is TaskResult.Success->true;
is TaskResult.Failure->true;
is TaskResult.Retry->attempt>=maxAttempts
};
// 4. Inline functions with reified generics;
inline fun<reified T:TaskResult>List<TaskResult > .filterResults():List<T > =
filterIsInstance<T>();
inline fun<reified T:Any>Task.payloadValue(key:String):T ? =
payload[key]as?T;
// 8. When expressions (exhaustive, with guards);
fun describeResult(result:TaskResult):String=when(result){
is TaskResult.Success->"OK: "+result.output;
is TaskResult.Failure->when{
result.error is IllegalArgumentException->"Bad input: "+result.error.message
else->"Error: "+result.error
};
is TaskResult.Retry->when{
result.attempt>=result.maxAttempts->"Giving up after "+result.attempt+" attempts"
else->"Retry "+result.attempt+"/"+result.maxAttempts
}
};
fun categorizePriority(p:TaskPriority):String=when(p){
TaskPriority.LOW,TaskPriority.MEDIUM->"normal";
TaskPriority.HIGH->"elevated";
TaskPriority.CRITICAL->"urgent"
};
// 19. Vararg parameters;
fun createTasks(vararg names:String,priority:TaskPriority=TaskPriority.MEDIUM):List<Task > =
names.mapIndexed{idx,name->
Task(id=idx.toLong(),name=name,priority=priority)
};
// 16. Range expressions and progressions;
fun workerIds(poolSize:Int):List<Int > =(1..poolSize).toList();
fun batchRanges(total:Int,batchSize:Int):List<IntRange > =
(0 until total step batchSize).map{it until minOf(it+batchSize,total)};
// Main pool class using coroutines;
class WorkerPool(
private val size:Int,
private val factory:WorkerFactory,
loggerImpl:Logger=ConsoleLogger("Pool")
):Logger by loggerImpl{
private val workers:List<Worker>by lazy{
workerIds(size).map{factory(it)}
};
private val completedCount=AtomicInteger(0);
private val failedCount=AtomicInteger(0);
// 9. Companion object;
companion object{
const val DEFAULT_SIZE=4;
const val MAX_SIZE=64;
fun default(handler:TaskHandler):WorkerPool=
WorkerPool(DEFAULT_SIZE,{id->Worker(id,handler)})
};
fun stats():PoolStats{
// 8. Destructuring declarations;
val(total,completed,failed)=Triple(
completedCount.get()+failedCount.get(),
completedCount.get(),
failedCount.get()
);
return PoolStats(total,completed,failed,workers.size)
};
// 5. Coroutines (suspend fun, coroutineScope, async);
suspend fun submitAll(tasks:List<Task>):List<TaskResult > =coroutineScope{
val sorted=tasks.sortedByPriority();
log("Submitting "+sorted.size+" tasks to "+size+" workers");
sorted.mapIndexed{index,task->
val worker=workers[index%workers.size];
async{
log("Dispatching '"+task.name+"' to worker "+worker.id);
val result=worker.execute(task);
when(result){
is TaskResult.Success->completedCount.incrementAndGet();
is TaskResult.Failure->failedCount.incrementAndGet();
is TaskResult.Retry->{}
};
result
}
}.awaitAll()
};
// 5. runBlocking;
fun submitBlocking(tasks:List<Task>):List<TaskResult > =runBlocking{
submitAll(tasks)
};
fun shutdown(){
log("Shutting down pool with "+workers.size+" workers");
val(_,completed,failed,active)=stats();
log("Final stats: completed="+completed+", failed="+failed+", active="+active)
}
};
// 11. Lambda with receiver (DSL-style builder);
class PoolConfig{
var poolSize:Int=WorkerPool.DEFAULT_SIZE;
var logPrefix:String="Pool";
var handler:TaskHandler={TaskResult.Success(it.id,"done")};
fun handler(block:TaskHandler){this.handler=block}
};
fun workerPool(configure:PoolConfig.()->Unit):WorkerPool{
val config=PoolConfig().apply(configure);
return WorkerPool(
size=config.poolSize,
factory={id->Worker(id,config.handler)},
loggerImpl=ConsoleLogger(config.logPrefix)
)
};
// Entry point demonstrating all features;
fun main(){
val pool=workerPool{
poolSize=3;
logPrefix="Demo";
handler{task->
delay(100);
val key=task.payloadValue<String>("key");
val output=key?.uppercase()?:("processed-"+task.name);
TaskResult.Success(task.id,output)
}
};
val tasks=buildTaskList{
addAll(createTasks("fetch-data","parse-json","validate",priority=TaskPriority.HIGH));
add(Task(100,"cleanup",TaskPriority.LOW,mapOf("key"to"temp")));
add(Task(101,"report",TaskPriority.CRITICAL,timeoutMs=10_000L))
};
// 8. Destructuring + 12. String templates;
for((id,name,priority,payload,timeout)in tasks){
println("Queued: #"+id+" '"+name+"' ["+priority.display()+"] timeout="+timeout+"ms payload="+payload)
};
// 16. Range expressions;
val batches=batchRanges(tasks.size,2);
println("Processing in "+batches.size+" batches: "+batches);
val results=pool.submitBlocking(tasks);
// 4. Reified inline filtering;
val successes=results.filterResults<TaskResult.Success>();
val failures=results.filterResults<TaskResult.Failure>();
successes.forEach{println("  OK: "+describeResult(it))};
failures.forEach{println("  FAIL: "+describeResult(it))};
// 13. Null safety chain;
val firstSuccess=successes.firstOrNull();
val outputUpper=firstSuccess?.output?.uppercase()?:"none";
println("First success output: "+outputUpper);
// 20. Try/catch as expression;
val parsed:Int=try{"notAnInt".toInt()}catch(_:NumberFormatException){-1};
println("Parsed fallback: "+parsed);
pool.shutdown()
}
