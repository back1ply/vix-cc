package workerpool;// 9. Static imports
import static java.util.stream.Collectors.toList;import static java.util.stream.Collectors.joining;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.AtomicInteger;import java.util.function.*;import java.util.stream.*;// 6. Annotations (custom)
@java.lang.annotation.Retention(java.lang.annotation.RetentionPolicy.RUNTIME)@java.lang.annotation.Target(java.lang.annotation.ElementType.METHOD)@interface Tracked{String value()default"";}
/* Core enum and record definitions for the worker pool.
   These types are shared across all pool components. */
/**
 * Priority levels for tasks submitted to the worker pool.
 * Each level has a numeric weight used for scheduling order.
 * @param level the numeric priority value
 * @param label a human-readable description
 * @return the display string combining label and icon
 */
// 16. Enum with fields and methods
enum TaskPriority{LOW(0,"low"),MEDIUM(5,"medium"),HIGH(10,"high"),CRITICAL(20,"critical");private final int level;private final String label;TaskPriority(int level,String label){this.level=level;this.label=label;}public int level(){return level;}public String label(){return label;}
// 10. Enhanced switch expression
public String icon(){return switch(this){case LOW->".";case MEDIUM->"*";case HIGH->"!";case CRITICAL->"!!!";};}public String display(){return label+"("+icon()+")";}}
// 1. Records
record Task(long id,String name,TaskPriority priority,Map<String,Object>payload){Task(long id,String name,TaskPriority priority){this(id,name,priority,Map.of());}
// 20. Ternary expression
String describe(){var payloadInfo=payload.isEmpty()?"none":payload.keySet().stream().collect(joining(","));return"Task#%d[%s] priority=%s payload={%s}".formatted(id,name,priority.display(),payloadInfo);}}record TaskResult(long taskId,boolean success,String output,Exception error){static TaskResult ok(long taskId,String output){return new TaskResult(taskId,true,output,null);}static TaskResult fail(long taskId,Exception error){return new TaskResult(taskId,false,null,error);}}record PoolStats(int totalTasks,int completed,int failed,int activeWorkers){}
// 2. Sealed interface
sealed interface PoolEvent permits PoolEvent.TaskSubmitted,PoolEvent.TaskCompleted,PoolEvent.Shutdown{record TaskSubmitted(Task task)implements PoolEvent{}record TaskCompleted(TaskResult result)implements PoolEvent{}record Shutdown(String reason)implements PoolEvent{}}
// 18. Functional interfaces
@FunctionalInterface interface TaskHandler{TaskResult handle(Task task)throws Exception;}@FunctionalInterface interface WorkerFactory{Worker create(int id,TaskHandler handler);}
// 8. Default methods in interfaces
interface Loggable{String prefix();default void log(String message){System.out.println("["+prefix()+"] "+message);}default void error(String message,Throwable t){System.err.println("["+prefix()+"] ERROR: "+message);if(t!=null)t.printStackTrace(System.err);}}
// 3. Pattern matching in instanceof
class EventProcessor{static String describe(PoolEvent event){if(event instanceof PoolEvent.TaskSubmitted ts)return"Submitted: "+ts.task().describe();else if(event instanceof PoolEvent.TaskCompleted tc&&tc.result().success())return"OK: task "+tc.result().taskId();else if(event instanceof PoolEvent.TaskCompleted tc)return"FAIL: task "+tc.result().taskId();else if(event instanceof PoolEvent.Shutdown sd)return"Shutdown: "+sd.reason();return"Unknown event";}}class Worker implements Loggable{private final int id;private final TaskHandler handler;private volatile Task currentTask;Worker(int id,TaskHandler handler){this.id=id;this.handler=handler;}@Override public String prefix(){return"Worker-"+id;}public int id(){return id;}@Tracked("execute")@SuppressWarnings("unchecked")
// 6. Annotations
public TaskResult execute(Task task){currentTask=task;try{log("Processing: "+task.name());return handler.handle(task);}catch(Exception e){error("Failed on task "+task.id(),e);return TaskResult.fail(task.id(),e);}finally{currentTask=null;}}
// 14. Optional<T>
public Optional<Task>currentTask(){return Optional.ofNullable(currentTask);}public String status(){return currentTask().map(t->"busy with "+t.name()).orElse("idle");}}
// Main pool class
class WorkerPool implements Loggable,AutoCloseable{private final List<Worker>workers;private final ExecutorService executor;private final AtomicInteger completed=new AtomicInteger(0);private final AtomicInteger failed=new AtomicInteger(0);WorkerPool(int size,WorkerFactory factory,TaskHandler handler){this.executor=Executors.newFixedThreadPool(size);// 19. Arrays and collections + 11. var
var list=new ArrayList<Worker>(size);for(var i=0;i<size;i++){list.add(factory.create(i+1,handler));}this.workers=Collections.unmodifiableList(list);}@Override public String prefix(){return"Pool";}
// 5. Generics with wildcards (? extends)
public List<TaskResult>submitAll(List<?extends Task>tasks){
// 15. Comparator chaining
var sorted=tasks.stream().sorted(Comparator.comparing(Task::priority,Comparator.comparingInt(TaskPriority::level)).reversed().thenComparing(Task::name)).collect(toList());log("Submitting "+sorted.size()+" tasks to "+workers.size()+" workers");// 12. Lambda expressions and method references + 13. Stream API
List<Future<TaskResult>>futures=sorted.stream().map(task->{var worker=workers.get((int)(task.id()%workers.size()));return executor.submit(()->{var result=worker.execute(task);if(result.success()){completed.incrementAndGet();}else{failed.incrementAndGet();}return result;});}).collect(toList());return futures.stream().map(f->{try{return f.get(5,TimeUnit.SECONDS);}catch(Exception e){return TaskResult.fail(-1,e instanceof Exception ex?ex:new RuntimeException(e));}}).toList();}
// 13. Stream API (map, filter, collect, reduce)
public String summary(List<TaskResult>results){var ok=results.stream().filter(TaskResult::success).count();var fail=results.stream().filter(r->!r.success()).count();var outputs=results.stream().filter(TaskResult::success).map(TaskResult::output).collect(joining(", "));var totalLen=results.stream().filter(TaskResult::success).map(r->r.output().length()).reduce(0,Integer::sum);return"Results: %d ok, %d failed, outputs=[%s], totalLen=%d".formatted(ok,fail,outputs,totalLen);}
// 17. Synchronized block
public synchronized PoolStats stats(){return new PoolStats(completed.get()+failed.get(),completed.get(),failed.get(),workers.size());}
// 5. Generics with wildcards (? super)
public void drainTo(Collection<?super TaskResult>sink,List<TaskResult>results){results.stream().filter(TaskResult::success).forEach(sink::add);}@Override public void close(){log("Shutting down pool");executor.shutdown();try{if(!executor.awaitTermination(10,TimeUnit.SECONDS))executor.shutdownNow();}catch(InterruptedException e){executor.shutdownNow();Thread.currentThread().interrupt();}var s=stats();log("Final: completed=%d, failed=%d".formatted(s.completed(),s.failed()));}}
// Entry point
public class tmp{
// 4. Text block
private static final String BANNER="""
            =============================
              Worker Pool Demo
              Java 17+ Features
            =============================""";public static void main(String[]args){System.out.println(BANNER);// 10. Enhanced switch expression with yield
TaskHandler handler=task->switch(task.priority()){case CRITICAL->{Thread.sleep(50);yield TaskResult.ok(task.id(),"URGENT:"+task.name().toUpperCase());}case HIGH,MEDIUM->TaskResult.ok(task.id(),"processed:"+task.name());case LOW->TaskResult.ok(task.id(),"deferred:"+task.name());};// 7. Try-with-resources
try(var pool=new WorkerPool(3,Worker::new,handler)){
// 19. Arrays and collections
var tasks=List.of(new Task(1,"fetch-data",TaskPriority.HIGH,Map.of("url","https://api.example.com")),new Task(2,"parse-json",TaskPriority.HIGH),new Task(3,"validate",TaskPriority.MEDIUM),new Task(4,"cleanup",TaskPriority.LOW,Map.of("path","/tmp")),new Task(5,"alert",TaskPriority.CRITICAL));// 11. var
var results=pool.submitAll(tasks);// 13. Stream + 12. Lambda + method references
results.stream().filter(TaskResult::success).map(r->"  OK: task %d -> %s".formatted(r.taskId(),r.output())).forEach(System.out::println);results.stream().filter(r->!r.success()).map(r->"  FAIL: task %d -> %s".formatted(r.taskId(),r.error().getMessage())).forEach(System.out::println);System.out.println(pool.summary(results));// 14. Optional
Optional<String>firstOutput=results.stream().filter(TaskResult::success).map(TaskResult::output).findFirst();System.out.println("First output: "+firstOutput.orElse("none"));// 3. Pattern matching instanceof
PoolEvent event=new PoolEvent.TaskCompleted(results.getFirst());System.out.println("Event: "+EventProcessor.describe(event));// 5. Wildcards (? super)
var sink=new ArrayList<Object>();pool.drainTo(sink,results);System.out.println("Drained "+sink.size()+" results");// 20. Ternary
var allOk=results.stream().allMatch(TaskResult::success);System.out.println("Status: "+(allOk?"ALL PASSED":"SOME FAILED"));}}}
