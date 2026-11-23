import {isIP} from 'node:net';

const normalize=address=>typeof address==='string'?address.replace(/^::ffff:/i,''):'';
const loopbackHost=host=>['localhost','127.0.0.1','::1','[::1]'].includes(String(host||'').toLowerCase());

// An operator may identify the exact relay for a Docker port published ONLY
// on host loopback. Never infer this trust from private IP ranges or headers.
export function mayTransmitAiKey(req,trustedPeers=process.env.LABOS_AI_TRUSTED_LOOPBACK_PEERS||''){
 if(req.secure)return true;
 const peer=normalize(req.socket?.remoteAddress);
 if(['127.0.0.1','::1'].includes(peer))return true;
 if(typeof trustedPeers!=='string'||trustedPeers.length>512||!loopbackHost(req.hostname))return false;
 const peers=trustedPeers.split(',').map(value=>normalize(value.trim())).filter(Boolean);
 if(!peers.length||peers.length>16||peers.some(value=>!isIP(value)))return false;
 return peers.includes(peer);
}
