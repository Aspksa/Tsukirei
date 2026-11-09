/** Local-only, non-overlapping background task coordinator. */
export type ScheduledTask={name:string;intervalMs:number;run:()=>Promise<unknown>|unknown};
export class BackgroundScheduler{
 private tasks=new Map<string,{task:ScheduledTask;timer:ReturnType<typeof setInterval>;running:boolean;lastRun:string|null;lastError:string|null}>();
 private closed=false;
 add(task:ScheduledTask){
  if(this.closed)throw Error('Планировщик закрыт');
  if(!task.name||!Number.isSafeInteger(task.intervalMs)||task.intervalMs<1000||this.tasks.has(task.name))throw Error('Неверная фоновая задача');
  const entry={task,timer:null as unknown as ReturnType<typeof setInterval>,running:false,lastRun:null as string|null,lastError:null as string|null};
  entry.timer=setInterval(()=>{void this.run(task.name);},task.intervalMs);
  entry.timer.unref?.();
  this.tasks.set(task.name,entry);
 }
 async run(name:string){
  const entry=this.tasks.get(name);
  if(!entry||this.closed||entry.running)return false;
  entry.running=true;
  try{await entry.task.run();entry.lastRun=new Date().toISOString();entry.lastError=null;return true;}
  catch(e){entry.lastError=e instanceof Error?e.message:String(e);console.warn('[Background]',name,entry.lastError);return false;}
  finally{entry.running=false;}
 }
 status(){return [...this.tasks.entries()].map(([name,e])=>({name,running:e.running,lastRun:e.lastRun,lastError:e.lastError,intervalMs:e.task.intervalMs}));}
 close(){this.closed=true;for(const entry of this.tasks.values())clearInterval(entry.timer);this.tasks.clear();}
}
