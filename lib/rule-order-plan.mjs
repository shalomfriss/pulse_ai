export function planRuleOrder(rule,signal,quantity,pending,clientOrderId){
  if(!signal.triggered) return {outcome:"condition_false"};
  if(pending) return {outcome:"open_order_exists"};
  const decimal=typeof quantity==="string"?quantity:String(quantity);
  if(!/^\d+(?:\.\d+)?$/.test(decimal)||!Number.isFinite(Number(decimal))) throw new Error("Broker position has an invalid quantity");
  const owned=Number(decimal);
  if(rule.action==="buy"){
    if(owned!==0) return {outcome:"position_already_open"};
    return {outcome:"ready",payload:{symbol:rule.symbol,side:"buy",type:"market",time_in_force:"day",notional:rule.notionalUsd.toFixed(2),client_order_id:clientOrderId}};
  }
  if(owned<=0) return {outcome:"no_position"};
  return {outcome:"ready",payload:{symbol:rule.symbol,side:"sell",type:"market",time_in_force:"day",qty:decimal,client_order_id:clientOrderId}};
}
