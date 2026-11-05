<?php
// Tree-sitter minifier test fixture: PHP Worker Pool
// Features: traits, interfaces, abstract classes, named arguments, union/intersection types,
// readonly properties, fibers, first-class callables, spread operator, enums with methods,
// match expressions, constructor promotion, null-safe operator, arrow functions, attributes,
// backed enums, closures/Closure::bind, generators, type declarations, ternary/null coalescing
declare(strict_types=1);// --- Backed enum with methods ---
enum TaskPriority:int{case Low=0;case Normal=5;case High=10;case Critical=20;public function label():string{return match($this){self::Critical=>'CRIT',self::High=>'WARN',self::Normal=>'INFO',self::Low=>'DEBUG',};}public function isUrgent():bool{return$this->value>=10;}}
// --- Named enum ---
enum WorkerState{case Idle;case Busy;case Draining;case Stopped;}
// --- Attribute ---
#[Attribute(Attribute::TARGET_METHOD)]class Monitored{public function __construct(public readonly string$metric='default'){}}
// --- Interface ---
interface PoolInterface{public function submit(WorkItem$item):mixed;public function stats():WorkerStats;}
// --- Traits ---
trait Loggable{private function log(string$level,string$message):void{echo"[".date('H:i:s')."] {$level}: {$message}\n";}}trait HasCallbacks{private array$callbacks=[];public function on(string$event,Closure$fn):void{$this->callbacks[$event][]=$fn;}private function fire(string$event,mixed...$args):void{foreach($this->callbacks[$event]??[]as$cb){$cb(...$args);}}}
// --- Abstract class ---
abstract class BasePool implements PoolInterface{use Loggable;use HasCallbacks;abstract protected function processItem(WorkItem$item):mixed;}
// --- Readonly properties + constructor promotion ---
class WorkItem{public function __construct(public readonly string$id,public readonly TaskPriority$priority,public readonly Closure$payload,public readonly float$enqueuedAt=0.0,){}}class WorkerStats{public function __construct(public readonly int$completed,public readonly int$failed,public readonly float$avgLatency,){}public function summary():string{return"done={$this->completed}, failed={$this->failed}, avg=".number_format($this->avgLatency,2)."ms";}}
// --- Main pool with union types ---
class WorkerPool extends BasePool{
/** @var WorkItem[] */
private array$queue=[];private int$completed=0;private int$failed=0;private float$totalLatency=0.0;private WorkerState$state=WorkerState::Idle;// Constructor promotion
public function __construct(private readonly string$name,private readonly int$maxConcurrency=4,private readonly int|float$timeout=30,){parent::__construct();}public function enqueue(WorkItem$item):void{$this->queue[]=$item;$this->log('DEBUG',"Enqueued {$item->id}");}
// Union type return + attribute
#[Monitored(metric:'pool.submit')]public function submit(WorkItem$item):string|null{$this->enqueue($item);return$this->processItem($item);}
// Intersection type parameter
public function submitFromIterable(iterable&\Countable$items):array{$results=[];foreach($items as$item){$results[]=$this->submit($item);}return$results;}protected function processItem(WorkItem$item):string|null{$start=hrtime(true);try{$result=($item->payload)();$elapsed=(hrtime(true)-$start)/1e6;$this->completed++;$this->totalLatency+=$elapsed;$this->fire('completed',$item);$this->log($item->priority->label(),"Task {$item->id} done");return is_string($result)?$result:null;}catch(\Throwable$e){$this->failed++;$this->log('ERROR',"Task {$item->id}: {$e->getMessage()}");$this->fire('failed',$item);return null;}}
// Match expression
public function classify():string{$s=$this->stats();return match(true){$s->failed===0&&$s->completed>100=>'Healthy-HighThroughput',$s->failed===0=>'Healthy',$s->failed>$s->completed=>'Degraded',default=>'Unknown',};}
// Ternary and null coalescing
public function stats():WorkerStats{$avg=$this->completed>0?$this->totalLatency/$this->completed:0.0;return new WorkerStats(completed:$this->completed,failed:$this->failed,avgLatency:$avg);}
// Null-safe operator
public function safeName():string{$meta=$this->getMeta();return$meta?->name??$this->name??'UNNAMED';}private function getMeta():?object{return(object)['name'=>$this->name];}
// Generator (yield)
public function drain():\Generator{$this->state=WorkerState::Draining;while($item=array_shift($this->queue)){yield$item->id=>$this->processItem($item);}$this->state=WorkerState::Idle;}
// Arrow function + spread operator
public function drainHighPriority():array{$high=array_filter($this->queue,fn(WorkItem$i)=>$i->priority->isUrgent());usort($high,fn(WorkItem$a,WorkItem$b)=>$b->priority->value<=>$a->priority->value);$results=array_map(fn(WorkItem$i)=>$this->processItem($i),$high);$this->queue=array_values(array_filter($this->queue,fn(WorkItem$i)=>!$i->priority->isUrgent()));return$results;}public function getState():WorkerState{return$this->state;}}
// --- Fiber ---
function runInFiber(WorkerPool$pool,WorkItem$item):string{$fiber=new Fiber(function()use($pool,$item):void{$pool->enqueue($item);Fiber::suspend('enqueued');$pool->submit($item);Fiber::suspend('submitted');});$status=$fiber->start();echo"Fiber status: {$status}\n";$status=$fiber->resume();echo"Fiber status: {$status}\n";return'fiber-done';}
// --- Closure::bind ---
function inspectPool(WorkerPool$pool):Closure{return Closure::bind(function(){return"Internal: queue=".count($this->queue).", state=".$this->state->name;},$pool,WorkerPool::class);}
// --- First-class callable ---
function getSubmitter(WorkerPool$pool):Closure{return$pool->submit(...);}
// --- Top-level usage ---
$pool=new WorkerPool(name:'main-pool',maxConcurrency:8,timeout:30.0,);$pool->on('completed',function(WorkItem$item):void{echo"Callback: {$item->id} completed\n";});$items=[];for($i=1;$i<=5;$i++){$pri=$i>3?TaskPriority::High:TaskPriority::Normal;$items[]=new WorkItem(id:"job-{$i}",priority:$pri,payload:fn()=>"result-{$i}",enqueuedAt:microtime(true),);}
// Spread operator
$pool->enqueue(...array_slice($items,0,1));// First-class callable
$submitter=getSubmitter($pool);$submitter($items[1]);// Generator drain
foreach($pool->drain()as$id=>$result){$label=$result??'null';echo"Drained {$id}: {$label}\n";}
// Fiber
runInFiber($pool,$items[2]);// Closure::bind inspection
$inspector=inspectPool($pool);echo$inspector()."\n";// Stats
echo$pool->stats()->summary()."\n";echo$pool->classify()."\n";echo$pool->safeName()."\n";
