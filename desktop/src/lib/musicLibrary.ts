export type MusicTrack = {
    id: string;
    name: string;
    addedAt?: number;
    lastModified?: number;
    collectionId?: string;
    collectionName?: string;
    relativePath?: string;
    contentId?: string;
    artwork?: Blob;
    artworkChecked?: boolean;
    title?: string;
    artist?: string;
    album?: string;
    metadataChecked?: boolean;
};
export type StoredMusicTrack = MusicTrack & {
    blob: Blob;
};
export type MusicPlaylist = {
    id: string;
    name: string;
    trackIds: string[];
    createdAt: number;
};
export type MusicQueue = {
    id: string;
    name: string;
    sourceKey?: string;
    trackIds: string[];
    currentId: string | null;
    position: number;
    shuffle: boolean;
    repeat: 'off' | 'all' | 'one';
};
export type MusicState = {
    id: 'player';
    activeId: string | null;
    queues: MusicQueue[];
};
let database: Promise<IDBDatabase> | undefined;
function openMusicDb() {
    return database ||= new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('labos-local-media', 3);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('tracks'))
                db.createObjectStore('tracks', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('playlists'))
                db.createObjectStore('playlists', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('state'))
                db.createObjectStore('state', { keyPath: 'id' });
            const tracks = request.transaction!.objectStore('tracks');
            if (!tracks.indexNames.contains('contentId'))
                tracks.createIndex('contentId', 'contentId');
        };
        request.onsuccess = () => {
            request.result.onversionchange = () => { request.result.close(); database = undefined; };
            resolve(request.result);
        };
        request.onerror = () => { database = undefined; reject(request.error); };
        request.onblocked = () => { database = undefined; reject(new Error('Close other music library windows and retry.')); };
    });
}
export async function musicRead<T>(store: string, id: string): Promise<T | undefined> {
    const db = await openMusicDb();
    return new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
export async function musicWrite(store: string, value: unknown) {
    const db = await openMusicDb();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Music storage write failed'));
    });
}
/** Keep audio bytes out of React state; retrieve only the selected track's blob. */
export async function musicLibrary(): Promise<{
    tracks: MusicTrack[];
    playlists: MusicPlaylist[];
}> {
    const db = await openMusicDb();
    return new Promise((resolve, reject) => {
        const tracks: MusicTrack[] = [], playlists: MusicPlaylist[] = [];
        const tx = db.transaction(['tracks', 'playlists']);
        const cursor = tx.objectStore('tracks').openCursor();
        cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row)
                return;
            const { blob: _blob, artwork: _artwork, ...metadata } = row.value as StoredMusicTrack;
            tracks.push(metadata);
            row.continue();
        };
        const ps = tx.objectStore('playlists').getAll();
        ps.onsuccess = () => playlists.push(...ps.result);
        tx.oncomplete = () => resolve({ tracks: tracks.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)), playlists });
        tx.onerror = tx.onabort = () => reject(tx.error);
    });
}
export function uniqueMusicIds(ids: string[], tracks?: MusicTrack[]) {
    const known = tracks && new Map(tracks.map(track => [track.id, track]));
    const canonical = new Map<string, string>();
    tracks?.forEach(track => { const key = track.contentId || track.id; if (!canonical.has(key))
        canonical.set(key, track.id); });
    const seen = new Set<string>(), result: string[] = [];
    for (const id of ids) {
        const track = known?.get(id);
        if (known && !track)
            continue;
        const key = track?.contentId || id;
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(canonical.get(key) || id);
    }
    return result;
}
export function normalizeMusicQueue(queue: MusicQueue, tracks: MusicTrack[]): MusicQueue {
    const trackIds = uniqueMusicIds(queue.trackIds, tracks), id = queue.currentId ? uniqueMusicIds([queue.currentId], tracks)[0] : null;
    const currentId = id && trackIds.includes(id) ? id : null;
    return { ...queue, trackIds, currentId, position: currentId && Number.isFinite(queue.position) ? Math.max(0, queue.position) : 0 };
}
export function moveMusicId(ids: string[], id: string, before: string): string[] {
    if (id === before || !ids.includes(id) || !ids.includes(before))
        return uniqueMusicIds(ids);
    const result = uniqueMusicIds(ids).filter(value => value !== id);
    result.splice(result.indexOf(before), 0, id);
    return result;
}
/** Clamp after removal/filter changes so a formerly valid last page never goes blank. */
export function musicPage(total:number,requested:number,size=48){
    const pages=Math.max(1,Math.ceil(Math.max(0,total)/size));
    const page=Math.min(pages,Math.max(1,Number.isFinite(requested)?Math.floor(requested):1));
    return {page,pages,start:(page-1)*size,end:page*size};
}
export function addMusicIds(queue: MusicQueue, ids: string[], where: 'next' | 'end', tracks: MusicTrack[]): MusicQueue {
    const additions = uniqueMusicIds(ids, tracks).filter(id => id !== queue.currentId);
    if (where === 'end')
        return { ...queue, trackIds: uniqueMusicIds([...queue.trackIds, ...additions], tracks) };
    const keys = new Map(tracks.map(t => [t.id, t.contentId || t.id]));
    const additionKeys = new Set(additions.map(id => keys.get(id) || id));
    const rest = uniqueMusicIds(queue.trackIds, tracks).filter(id => id === queue.currentId || !additionKeys.has(keys.get(id) || id));
    const index = Math.max(0, rest.indexOf(queue.currentId || '') + 1);
    return { ...queue, trackIds: uniqueMusicIds([...rest.slice(0, index), ...additions, ...rest.slice(index)], tracks) };
}
/** Shuffle the actual queue order once; persisted/displayed order is the playback order. */
export function shuffleMusicIds(ids:string[],random=Math.random):string[]{
    const result=uniqueMusicIds(ids);
    for(let i=result.length-1;i>0;i--){const j=Math.min(i,Math.floor(random()*(i+1)));[result[i],result[j]]=[result[j],result[i]];}
    return result;
}
export function nextQueueTrack(queue:MusicQueue,ended:boolean):string|null{
    const ids=uniqueMusicIds(queue.trackIds);if(!ids.length)return null;
    if(ended&&queue.repeat==='one'&&queue.currentId&&ids.includes(queue.currentId))return queue.currentId;
    const next=ids[ids.indexOf(queue.currentId||'')+1];
    return next||(queue.repeat==='all'||!ended?ids[0]:null);
}
export function musicFolderEntries(tracks: MusicTrack[], path: string, search: string, flat: boolean) {
    const prefix = path ? `${path}/` : '';
    const folders = new Set<string>();
    const files: MusicTrack[] = [];
    for (const track of tracks) {
        const relative = track.relativePath || track.name;
        if (!relative.startsWith(prefix) || !`${track.name} ${track.title||''} ${track.artist||''} ${track.album||''} ${relative}`.toLowerCase().includes(search.toLowerCase()))
            continue;
        const remainder = relative.slice(prefix.length), slash = remainder.indexOf('/');
        if (!flat && slash >= 0)
            folders.add(`${prefix}${remainder.slice(0, slash)}`);
        else
            files.push(track);
    }
    return { folders: [...folders].sort((a, b) => a.localeCompare(b)), files: files.sort((a, b) => (a.relativePath || a.name).localeCompare(b.relativePath || b.name, undefined, { numeric: true })) };
}
/** Versioned chunk digest: bounded memory, deterministic exact-byte identity, independent of filename/folder. */
export async function musicContentId(blob: Blob, signal?: AbortSignal): Promise<string> {
    const chunkSize = 1024 * 1024;
    const parts: string[] = [];
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
        signal?.throwIfAborted();
        const hash = await crypto.subtle.digest('SHA-256', await blob.slice(offset, offset + chunkSize).arrayBuffer());
        parts.push(Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''));
    }
    signal?.throwIfAborted();
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${blob.size}:${parts.join(':')}`));
    return `music-chunks-v1:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
export async function identifyExistingMusic(track: MusicTrack, contentId: string) {
    const db = await openMusicDb();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction('tracks', 'readwrite'), store = tx.objectStore('tracks'), read = store.get(track.id);
        read.onsuccess = () => { if (read.result)
            store.put({ ...read.result, contentId }); };
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
    });
}
/** Optional tag enrichment must not resurrect a deleted song or overwrite a newer stored row. */
export async function updateMusicTags(id:string,tags:Pick<MusicTrack,'title'|'artist'|'album'>):Promise<boolean>{
    const db=await openMusicDb();
    return new Promise((resolve,reject)=>{
        const tx=db.transaction('tracks','readwrite'),store=tx.objectStore('tracks'),read=store.get(id);let updated=false;
        read.onsuccess=()=>{if(!read.result)return;const clean:Record<string,string|boolean>={metadataChecked:true};
            for(const key of ['title','artist','album'] as const){const value=tags[key]?.trim();if(value)clean[key]=value.slice(0,500);}
            store.put({...read.result,...clean});updated=true;};
        tx.oncomplete=()=>resolve(updated);tx.onerror=tx.onabort=()=>reject(tx.error);
    });
}
/** Cache one bounded cover, including the absence of a cover; never rewrite audio bytes. */
export async function updateMusicArtwork(id:string,artwork?:Blob):Promise<boolean>{
    const db=await openMusicDb();
    return new Promise((resolve,reject)=>{
        const tx=db.transaction('tracks','readwrite'),store=tx.objectStore('tracks'),read=store.get(id);let updated=false;
        read.onsuccess=()=>{
            if(!read.result)return;
            const next={...read.result,artworkChecked:true};
            if(artwork?.size&&artwork.size<=4*1024*1024&&/^image\/(jpeg|png|webp|gif)$/i.test(artwork.type))next.artwork=artwork;
            else delete next.artwork;
            store.put(next);updated=true;
        };
        tx.oncomplete=()=>resolve(updated);tx.onerror=tx.onabort=()=>reject(tx.error);
    });
}
/** Digest lookup and insert share a transaction, so concurrent imports cannot add the same bytes twice. */
export async function insertMusic(track: StoredMusicTrack): Promise<boolean> {
    const db = await openMusicDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('tracks', 'readwrite'), store = tx.objectStore('tracks');
        let inserted = false;
        const lookup = store.index('contentId').getKey(track.contentId!);
        lookup.onsuccess = () => { if (lookup.result === undefined) {
            store.add(track);
            inserted = true;
        } };
        tx.oncomplete = () => resolve(inserted);
        tx.onerror = tx.onabort = () => reject(tx.error);
    });
}
export async function deleteMusicTrack(id: string) {
    const db = await openMusicDb();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['tracks', 'playlists', 'state'], 'readwrite');
        tx.objectStore('tracks').delete(id);
        for (const name of ['playlists', 'state']) {
            const request = tx.objectStore(name).openCursor();
            request.onsuccess = () => {
                const row = request.result;
                if (!row)
                    return;
                if (name === 'playlists')
                    row.update({ ...row.value, trackIds: row.value.trackIds.filter((x: string) => x !== id) });
                else if (row.key === 'player')
                    row.update({ ...row.value, queues: row.value.queues.map((q: MusicQueue) => ({ ...q, trackIds: q.trackIds.filter(x => x !== id), currentId: q.currentId === id ? null : q.currentId, position: q.currentId === id ? 0 : q.position })) });
                row.continue();
            };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
    });
}
export async function deleteMusicPlaylist(id: string) {
    const db = await openMusicDb();
    return new Promise<void>((resolve, reject) => { const tx = db.transaction('playlists', 'readwrite'); tx.objectStore('playlists').delete(id); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
}
