export function historyBoundary(value,endOfDay=false){
  const text=String(value);
  const date=new Date(text);
  if(!Number.isFinite(date.getTime())) return date;
  if(/^\d{4}-\d{2}-\d{2}$/.test(text)){
    if(date.toISOString().slice(0,10)!==text) return new Date(NaN);
    if(endOfDay) date.setUTCHours(23,59,59,999);
  }
  return date;
}
