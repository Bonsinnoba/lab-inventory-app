import {apiFetch,getApiErrorMessage} from './http';
import {captureAccountSession,isAccountSessionCurrent,getToken} from './auth';
export interface VoiceCapabilities{enabled:boolean;provider:string;model:string;disclosure:string;disclosure_id:string;max_bytes:number;max_recording_seconds:number;mime_types:string[];}
function session(){const value=captureAccountSession();if(!value||!getToken()||getToken()?.startsWith('local:'))throw new Error('Voice transcription needs a server connection and online sign-in. Text input remains available.');return value;}
export async function getVoiceCapabilities():Promise<VoiceCapabilities>{
 const s=session(),response=await apiFetch('/assistant/voice/capabilities',{cache:'no-store'});if(!response.ok)throw new Error(await getApiErrorMessage(response,'Voice transcription unavailable'));
 const result=await response.json();if(!isAccountSessionCurrent(s))throw new Error('Voice session changed');
 if(typeof result?.enabled!=='boolean'||typeof result.disclosure!=='string'||typeof result.disclosure_id!=='string'||!Number.isSafeInteger(result.max_bytes)||result.max_bytes<=0||result.max_bytes>6*1024*1024)throw new Error('Voice capability response is incomplete');return result;
}
export async function transcribeVoice(blob:Blob,consent:string,signal:AbortSignal):Promise<string>{
 const s=session();if(signal.aborted)throw new Error('Recording cancelled');
 const body=new FormData();body.append('consent',consent);body.append('audio',blob,'recording.webm');
 const response=await apiFetch('/assistant/voice/transcribe',{method:'POST',body,signal});
 if(!isAccountSessionCurrent(s)||signal.aborted)throw new Error('Voice session changed or recording cancelled');
 if(!response.ok)throw new Error(await getApiErrorMessage(response,'Transcription failed'));
 const result=await response.json();if(!isAccountSessionCurrent(s)||signal.aborted)throw new Error('Voice session changed or recording cancelled');
 if(result.review_required!==true||typeof result.text!=='string'||result.text.length>8000)throw new Error('Transcript was not confirmed');return result.text;
}
