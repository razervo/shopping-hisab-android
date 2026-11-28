import { useState } from "react";
import { Loader2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
const money=(paise)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(paise||0)/100);
export function PriceComparisonPanel({items=[],paidTotalPaise=0,pinCode=""}) {
 const [result,setResult]=useState(null),[loading,setLoading]=useState(false);
 const run=async()=>{
  if(!items.length)return toast.error("No purchased items to compare.");
  setLoading(true);setResult(null);
  try {
   const response=await fetch("/api/compare-basket",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:items.map(i=>({name:i.name||i.product_name,quantity:i.quantity??i.qty??i.planned_quantity??1,unit:i.unit||"pcs",paidPaise:i.paidPaise??i.amountPaise??null})),paidTotalPaise,pinCode})});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.error||"Comparison unavailable.");
   setResult(data);
  } catch(e){toast.error(e.message||"Online comparison failed.");}
  finally{setLoading(false);}
 };
 return <section className="mt-4 rounded-[22px] border border-border bg-white p-4">
  <div className="flex items-center justify-between gap-3"><div><h3 className="text-[14px] font-extrabold">Online basket comparison</h3><p className="mt-1 text-[11.5px] text-muted-foreground">Checks public listings; unavailable stores fall back to your history or an India price estimate.</p></div>
  <button type="button" onClick={run} disabled={loading} className="min-h-11 shrink-0 rounded-full bg-primary px-4 py-2 text-[11px] font-bold text-primary-foreground">{loading?<Loader2 className="inline h-4 w-4 animate-spin"/>:<ShoppingCart className="inline h-4 w-4"/>} {loading?"Checking…":"Compare Online Basket"}</button></div>
  {result?<div className="mt-3">
   <div className={"rounded-xl p-3 "+(result.netDiffPaise>=0?"bg-emerald-50 text-emerald-800":"bg-orange-50 text-orange-800")}><p className="text-[11px] font-semibold">{result.netDiffPaise>=0?"Profit (Saved)":"Loss (Paid more)"}</p><p className="mt-1 text-xl font-extrabold">{money(Math.abs(result.netDiffPaise))}</p><p className="mt-1 text-[10.5px]">{result.netDiffPaise>=0?"Your paid total is above the comparison basket.":"Your paid total is below the comparison basket."}</p></div>
   <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-[11px]"><thead><tr className="border-b text-muted-foreground"><th className="py-2 pr-2">Item</th><th className="py-2 px-1 text-right">Paid</th><th className="py-2 px-1 text-right">Online</th><th className="py-2 pl-1">Source</th></tr></thead><tbody>{result.items.map((row,index)=><tr key={index} className="border-b border-border/70"><td className="py-2 pr-2 font-semibold">{row.name}</td><td className="py-2 px-1 text-right">{row.paidPaise==null?"—":money(row.paidPaise)}</td><td className="py-2 px-1 text-right">{money(row.onlinePaise)}</td><td className="py-2 pl-1"><span>{row.sourceStore}</span>{row.sourceUrl?<a href={row.sourceUrl} target="_blank" rel="noreferrer" className="ml-1 text-primary underline">open</a>:null}</td></tr>)}</tbody></table></div>
   <div className="mt-2 flex justify-between border-t pt-3 text-[11.5px] font-bold"><span>Basket totals</span><span>Paid {money(result.paidTotalPaise)} · Online {money(result.onlineTotalPaise)}</span></div>
  </div>:null}
 </section>;
}
