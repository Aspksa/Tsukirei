/**
 * Local, evidence-based quality monitoring. Feedback is a subjective signal,
 * not a ground-truth answer correctness score. No model calls or autonomous edits.
 */
export type FeedbackEvent={at:string;rating:'positive'|'negative';sourceId:string};
export type FeedbackWindow={count:number;positive:number;negative:number;positiveRate:number|null;sourceIds:string[]};
export function feedbackQuality(events:FeedbackEvent[],now=new Date()){
  const timestamp=now.getTime(),day=86400000;
  const valid=events.filter(e=>{
    const t=Date.parse(e.at);
    return Number.isFinite(t)&&t<=timestamp&&t>=timestamp-60*day&&
      (e.rating==='positive'||e.rating==='negative')&&Boolean(e.sourceId);
  });
  const window=(from:number,to:number):FeedbackWindow=>{
    const rows=valid.filter(e=>{
      const age=timestamp-Date.parse(e.at);
      return age>=from*day&&age<to*day;
    });
    const positive=rows.filter(e=>e.rating==='positive').length;
    return {count:rows.length,positive,negative:rows.length-positive,
      positiveRate:rows.length?Math.round(positive/rows.length*100):null,
      sourceIds:[...new Set(rows.map(e=>e.sourceId))].slice(0,60)};
  };
  const current=window(0,30),previous=window(30,60);
  const enough=current.count>=5&&previous.count>=5;
  const delta=enough?current.positiveRate!-previous.positiveRate!:null;
  return {generatedAt:now.toISOString(),current,previous,deltaPercentagePoints:delta,
    trend:!enough?'insufficient-data':delta!>=10?'improving':delta!<=-10?'declining':'stable',
    minimumFeedbackPerWindow:5,method:'Доля положительных оценок в двух 30-дневных окнах',
    caveat:'Оценки пользователя не доказывают фактическую правильность ответов.'};
}
