import {useCallback,useEffect,useRef,useState} from 'react';

/** Only explicit user refreshes animate. Background query reads stay silent. */
export function useManualRefresh(){
  const [refreshing,setRefreshing]=useState(false);
  const mounted=useRef(true),pending=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const refresh=useCallback(async(action:()=>unknown|Promise<unknown>)=>{
    if(pending.current)return;
    pending.current=true;setRefreshing(true);
    try{await action();}finally{pending.current=false;if(mounted.current)setRefreshing(false);}
  },[]);
  return {refresh,refreshing};
}
