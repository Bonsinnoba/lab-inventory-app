import {useLayoutEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import LoginPage from '../pages/LoginPage';
import type {User} from '../api/auth';
export default function ReauthenticationGate({owner,onLogin,notice}:{owner:User;onLogin:(user:User,token:string)=>void|Promise<void>;notice?:string|null}){
 const dialog=useRef<HTMLDialogElement>(null);
 useLayoutEffect(()=>{const node=dialog.current;if(!node)return;if(!node.open)node.showModal();if(document.fullscreenElement)void document.exitFullscreen().catch(()=>undefined);const picture=document as Document&{pictureInPictureElement?:Element;exitPictureInPicture?:()=>Promise<void>};if(picture.pictureInPictureElement)void picture.exitPictureInPicture?.().catch(()=>undefined);return()=>{if(node.open)node.close();};},[]);
 return createPortal(<dialog ref={dialog} aria-label="Sign in to resume your workspace" aria-modal="true" onCancel={event=>event.preventDefault()} onKeyDownCapture={event=>event.stopPropagation()} className="fixed inset-0 m-0 h-screen max-h-none w-screen max-w-none border-0 bg-bg p-0 text-text-primary backdrop:bg-bg"><LoginPage lockedUsername={owner.username} onLoginSuccess={onLogin} notice={notice||`Sign in as ${owner.username} to resume your open workspace. Saved changes remain on this PC.`}/></dialog>,document.body);
}
