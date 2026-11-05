"""Worker-pool test fixture exercising Python 3.10+ language features."""
from __future__ import annotations
import functools
import threading
import time
from abc import ABC,abstractmethod
from concurrent.futures import ThreadPoolExecutor,Future
from contextlib import contextmanager
from dataclasses import dataclass,field
from enum import IntEnum
from typing import Any,Callable,Generator,Iterator
# ---------------------------------------------------------------------------
# Type aliases (PEP 604 union syntax)
# ---------------------------------------------------------------------------
TaskResult=dict[str,Any]
Callback=Callable[[TaskResult],None]|None
WorkerId=int|str
# ---------------------------------------------------------------------------
# IntEnum for priority levels
# ---------------------------------------------------------------------------
class Priority(IntEnum):
 LOW=0
 NORMAL=1
 HIGH=2
 CRITICAL=3
 def __str__(self)->str:
  return self.name.capitalize()
class Status(IntEnum):
 PENDING=0
 RUNNING=1
 DONE=2
 FAILED=3
 def __str__(self)->str:
  return self.name.capitalize()
# ---------------------------------------------------------------------------
# Custom decorator with arguments -- @retry(max_attempts=3)
# ---------------------------------------------------------------------------
def retry(max_attempts:int=3,delay:float=0.05):
 """Retry a callable up to *max_attempts* times on failure."""
 def decorator(fn):
  @functools.wraps(fn)
  def wrapper(*args,**kwargs):
   last_exc:BaseException|None=None
   for attempt in range(1,max_attempts+1):
    try:
     return fn(*args,**kwargs)
    except Exception as exc:
     last_exc=exc
     time.sleep(delay)
   raise RuntimeError(
    f"{fn.__name__} failed after {max_attempts} attempts"
   )from last_exc
  return wrapper
 return decorator
# ---------------------------------------------------------------------------
# Abstract base class
# ---------------------------------------------------------------------------
class BaseWorker(ABC):
 """Abstract worker that every concrete worker must subclass."""
 @abstractmethod
 def execute(self,payload:dict[str,Any])->TaskResult:
  ...
 @abstractmethod
 def health_check(self)->bool:
  ...
# ---------------------------------------------------------------------------
# Mixin for logging (used in multiple inheritance)
# ---------------------------------------------------------------------------
class LogMixin:
 _log:list[str]=[]
 def log(self,message:str)->None:
  self._log.append(message)
 def dump_log(self)->Generator[str,None,None]:
  """Yield log lines one-by-one (generator with yield)."""
  for line in self._log:
   yield line
# ---------------------------------------------------------------------------
# Concrete worker -- multiple inheritance, __slots__, properties
# ---------------------------------------------------------------------------
class PoolWorker(BaseWorker,LogMixin):
 __slots__=("_id","_status","_tasks_done","_lock")
 def __init__(self,worker_id:WorkerId)->None:
  self._id=worker_id
  self._status:str="idle"
  self._tasks_done:int=0
  self._lock=threading.Lock()
 # -- properties (@property + @setter) ----------------------------------
 @property
 def status(self)->str:
  return self._status
 @status.setter
 def status(self,value:str)->None:
  allowed={"idle","busy","stopped"}
  if value not in allowed:
   raise ValueError(f"Invalid status {value!r}")
  self._status=value
 @property
 def worker_id(self)->WorkerId:
  return self._id
 # -- class method & static method --------------------------------------
 @classmethod
 def create_batch(cls,count:int)->list[PoolWorker]:
  return[cls(worker_id=i)for i in range(count)]
 @staticmethod
 def is_valid_id(wid:WorkerId)->bool:
  return isinstance(wid,(int,str))and bool(str(wid))
 # -- abstract method implementations -----------------------------------
 @retry(max_attempts=2,delay=0.01)
 def execute(self,payload:dict[str,Any])->TaskResult:
  self.status="busy"
  self.log(f"worker {self._id} executing")
  result:TaskResult={"worker":self._id,"ok":True,**payload}
  with self._lock:
   self._tasks_done+=1
  self.status="idle"
  return result
 def health_check(self)->bool:
  return self._status!="stopped"
# ---------------------------------------------------------------------------
# Dataclass task descriptor
# ---------------------------------------------------------------------------
@dataclass(order=True)
class Task:
 priority:Priority=field(compare=True)
 name:str=field(compare=False,default="unnamed")
 payload:dict[str,Any]=field(compare=False,default_factory=dict)
 retries:int=field(compare=False,default=0)
# ---------------------------------------------------------------------------
# Context manager (manual __enter__ / __exit__)
# ---------------------------------------------------------------------------
class PoolGuard:
 """Ensure pool is drained on exit -- with-statement support."""
 def __init__(self,pool:WorkerPool)->None:
  self._pool=pool
 def __enter__(self)->WorkerPool:
  self._pool.start()
  return self._pool
 def __exit__(self,exc_type,exc_val,exc_tb)->bool:
  self._pool.shutdown()
  return False
# ---------------------------------------------------------------------------
# Generator utility -- yield from
# ---------------------------------------------------------------------------
def _flatten(nested:list[list[Any]])->Generator[Any,None,None]:
 '''Flatten one level of nesting from a list of lists.'''
 for inner in nested:
  yield from inner
# ---------------------------------------------------------------------------
# contextmanager-decorated generator (another yield usage)
# ---------------------------------------------------------------------------
@contextmanager
def timed_section(label:str)->Generator[dict[str,float],None,None]:
 info:dict[str,float]={}
 start=time.monotonic()
 try:
  yield info
 finally:
  info["elapsed"]=time.monotonic()-start
# ---------------------------------------------------------------------------
# Worker pool -- ties everything together
# ---------------------------------------------------------------------------
_pool_registry:list[Any]=[]
class WorkerPool:
 _instance_count:int=0
 def __init__(self,size:int=4)->None:
  WorkerPool._instance_count+=1
  self._workers:list[PoolWorker]=PoolWorker.create_batch(size)
  self._executor:ThreadPoolExecutor|None=None
  self._results:list[TaskResult]=[]
  self._lock=threading.Lock()
 # -- global / nonlocal demo inside nested function ----------------------
 def start(self)->None:
  counter=0
  def _inc()->int:
   nonlocal counter
   counter+=1
   return counter
  global _pool_registry
  _pool_registry.append(self)
  _inc()
  self._executor=ThreadPoolExecutor(max_workers=len(self._workers))
 def shutdown(self)->None:
  if self._executor is not None:
   self._executor.shutdown(wait=True)
   self._executor=None
 # -- submit with match/case on priority ---------------------------------
 def submit(self,task:Task)->Future|None:
  if self._executor is None:
   return None
  match task.priority:
   case Priority.CRITICAL:
    worker=self._workers[0]
   case Priority.HIGH:
    worker=self._workers[min(1,len(self._workers)-1)]
   case Priority.NORMAL|Priority.LOW:
    worker=self._workers[-1]
   case _:
    raise ValueError(f"Unknown priority {task.priority}")
  future=self._executor.submit(worker.execute,task.payload)
  return future
 # -- collect results with walrus operator & tuple unpacking -------------
 def collect(self,futures:list[Future])->list[TaskResult]:
  results:list[TaskResult]=[]
  for f in futures:
   if(res:=f.result(timeout=5))is not None:
    results.append(res)
  return results
 # -- dict comprehension, set comprehension, list comprehension ----------
 def stats(self)->dict[str,Any]:
  id_set:set[WorkerId]={w.worker_id for w in self._workers}
  status_map:dict[WorkerId,str]={
   w.worker_id:w.status for w in self._workers
  }
  busy_ids:list[WorkerId]=[
   wid for wid,s in status_map.items()if s=="busy"
  ]
  return{
   "total":len(self._workers),
   "ids":id_set,
   "statuses":status_map,
   "busy":busy_ids,
  }
 # -- f-strings with format specs ----------------------------------------
 def report(self)->str:
  lines:list[str]=[]
  header=f"{'Worker':<18s} | {'Status':<10s} | {'Healthy':>7s}"
  lines.append(header)
  lines.append("-"*len(header))
  for w in self._workers:
   name=f"worker-{w.worker_id}"
   healthy="yes"if w.health_check()else"no"
   lines.append(f"{name:<18s} | {w.status:<10s} | {healthy:>7s}")
  return"\n".join(lines)
 # -- starred assignment / tuple unpacking --------------------------------
 def unpack_demo(self)->tuple[WorkerId,list[WorkerId],WorkerId]:
  ids=[w.worker_id for w in self._workers]
  first,*middle,last=ids
  return(first,middle,last)
 # -- generator expression -----------------------------------------------
 def idle_workers(self)->Iterator[PoolWorker]:
  return(w for w in self._workers if w.status=="idle")
 # -- nested function / closure -------------------------------------------
 def make_callback(self,prefix:str)->Callable[[TaskResult],str]:
  def _cb(result:TaskResult)->str:
   return f"{prefix}: {result}"
  return _cb
# ---------------------------------------------------------------------------
# Module-level generator using yield + yield from
# ---------------------------------------------------------------------------
def generate_tasks(
 names:list[str],priority:Priority=Priority.NORMAL
)->Generator[Task,None,None]:
 base=[Task(priority=priority,name=n)for n in names]
 yield from base
 yield Task(priority=Priority.CRITICAL,name="final-cleanup")
# ---------------------------------------------------------------------------
# Try / except / else / finally
# ---------------------------------------------------------------------------
def safe_run(pool:WorkerPool,task:Task)->TaskResult|None:
 result:TaskResult|None=None
 try:
  future=pool.submit(task)
  if future is None:
   raise RuntimeError("Pool not started")
  result=future.result(timeout=5)
 except TimeoutError:
  result={"error":"timeout","task":task.name}
 except RuntimeError as exc:
  result={"error":str(exc),"task":task.name}
 else:
  result.setdefault("status","completed")
 finally:
  if result is not None:
   result["finalized"]=True
 return result
# ---------------------------------------------------------------------------
# *args / **kwargs demo
# ---------------------------------------------------------------------------
def create_pool(*args:int,**kwargs:Any)->WorkerPool:
 size=args[0]if args else kwargs.get("size",4)
 return WorkerPool(size=size)
# ---------------------------------------------------------------------------
# Lambda + sorted
# ---------------------------------------------------------------------------
def sort_tasks(tasks:list[Task])->list[Task]:
 return sorted(tasks,key=lambda t:(-t.priority,t.name))
# ---------------------------------------------------------------------------
# Driver -- exercises every feature path
# ---------------------------------------------------------------------------
def main()->None:
 pool=create_pool(4,label="main")
 with PoolGuard(pool)as p:
  tasks=list(generate_tasks(["alpha","beta","gamma"]))
  tasks=sort_tasks(tasks)
  futures:list[Future]=[]
  for t in tasks:
   if(f:=p.submit(t))is not None:
    futures.append(f)
  results=p.collect(futures)
  with timed_section("report")as timing:
   report=p.report()
  print(report)
  print(f"Elapsed: {timing['elapsed']:.4f}s")
  print(f"Results: {len(results)}")
  # starred unpacking
  first,*rest=results or[{}]
  print(f"First result: {first}")
  # stats with dict/set comprehensions
  stats=p.stats()
  print(f"Worker ids: {stats['ids']}")
  # iterate idle workers (generator expression)
  idle=list(p.idle_workers())
  print(f"Idle count: {len(idle)}")
  # closure callback
  cb=p.make_callback("DONE")
  for r in results:
   print(cb(r))
  # flatten demo (yield from)
  batched=[[1,2],[3,4],[5]]
  flat=list(_flatten(batched))
  assert flat==[1,2,3,4,5]
  # match/case on raw value
  match len(results):
   case 0:
    print("No results")
   case n if n<3:
    print(f"Few results: {n}")
   case _:
    print(f"Got {len(results)} results")
 print("Pool shut down cleanly.")
if __name__=="__main__":
 main()
