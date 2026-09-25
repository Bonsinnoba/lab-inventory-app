import { useState, useRef } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Camera, X, Loader2, FileText, ExternalLink } from 'lucide-react';
import { uploadFile, deleteResource, getResourceDownloadUrl, getResources, getResourceAccessUrl, Resource } from '../api/resources';
import { updateItem } from '../api/items';
import { useToast } from '../contexts/ToastContext';

interface ItemPictureProps {
  itemId: string;
  imageResourceId: string | null | undefined;
}

export default function ItemPicture({ itemId, imageResourceId }: ItemPictureProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const datasheetInputRef = useRef<HTMLInputElement>(null);
  const [datasheetBusy, setDatasheetBusy] = useState(false);
  const [datasheetError, setDatasheetError] = useState<string | null>(null);
  const { data: linkedResources = [], isLoading: loadingDatasheets } = useQuery<Resource[]>({ queryKey: ['resources', { item_id: itemId }], queryFn: () => getResources({ item_id: itemId }) });
  const datasheets = linkedResources.filter(r => r.kind === 'file' && (r.file_type === 'pdf' || /datasheet/i.test([r.name, r.category, ...(r.tags || [])].join(' '))));
  async function addDatasheet(file: File) {
    setDatasheetBusy(true); setDatasheetError(null);
    try {
      await uploadFile(file, { item_id: itemId }, undefined, undefined, { category: 'datasheet', tags: ['datasheet'] });
      await queryClient.invalidateQueries({ queryKey: ['resources', { item_id: itemId }] });
      showToast('Datasheet attached');
    } catch (e) { setDatasheetError(e instanceof Error ? e.message : 'Unable to upload datasheet'); }
    finally { setDatasheetBusy(false); }
  }
  async function openDatasheet(resource: Resource) {
    try { const url = await getResourceAccessUrl(resource.id); window.open(url, '_blank', 'noopener,noreferrer'); }
    catch (e) { setDatasheetError(e instanceof Error ? e.message : 'Unable to open datasheet'); }
  }
  const [isUploading, setIsUploading] = useState(false);

  const downloadUrl = imageResourceId
    ? imageResourceId ? getResourceDownloadUrl(imageResourceId) : ''
    : null;

  const replaceMutation = useMutation({
    mutationFn: async (file: File) => {
      // An item has at most one picture — if one already exists, remove
      // it first so uploads don't silently pile up as orphaned resources
      // every time someone picks a new photo.
      const previousId = imageResourceId;
      const uploaded = await uploadFile(file, { item_id: itemId });
      // The picture is a dedicated field on the item, set explicitly here
      // — it is never inferred from "whatever image was last attached",
      // so this item's picture can't be hijacked by some other image
      // resource someone attaches to this item later.
      await updateItem(itemId, { image_resource_id: uploaded.id });
      if (previousId) {
        await deleteResource(previousId).catch(() => {});
      }
    },
    onMutate: () => setIsUploading(true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item', itemId] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['resources', { item_id: itemId }] });
      showToast('Picture updated');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to upload picture', 'error'),
    onSettled: () => setIsUploading(false),
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      await updateItem(itemId, { image_resource_id: null });
      await deleteResource(imageResourceId!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item', itemId] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['resources', { item_id: itemId }] });
      showToast('Picture removed');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to remove picture', 'error'),
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) replaceMutation.mutate(file);
    e.target.value = '';
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5 pb-5 border-b border-border">
    <div className="flex items-start gap-4">
      <div
        className="relative w-28 h-28 flex-shrink-0 rounded-md border border-border bg-surface-raised overflow-hidden group cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        {isUploading ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-text-secondary" />
          </div>
        ) : downloadUrl ? (
          <>
            <img src={downloadUrl} alt="Item picture" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-bg/0 group-hover:bg-bg/60 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
              <Camera size={18} className="text-text-primary" />
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-text-secondary group-hover:text-accent transition-colors">
            <Camera size={20} />
            <span className="text-xs">Add photo</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 pt-1">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="text-sm text-accent hover:underline text-left disabled:opacity-50"
        >
          {downloadUrl ? 'Change picture' : 'Add a picture'}
        </button>
        {downloadUrl && (
          <button
            onClick={() => { if (window.confirm('Remove this item picture?')) removeMutation.mutate(); }}
            disabled={removeMutation.isPending}
            className="text-sm text-text-secondary hover:text-status-danger text-left flex items-center gap-1 disabled:opacity-50"
          >
            <X size={13} />
            Remove
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
    <div className="min-w-0 border border-border rounded-md p-3 bg-surface-raised/40">
      <div className="flex items-center justify-between gap-2 mb-2"><span className="flex items-center gap-1.5 text-sm font-medium"><FileText size={16}/> Datasheets</span><button type="button" disabled={datasheetBusy} onClick={()=>datasheetInputRef.current?.click()} className="text-xs text-accent hover:underline disabled:opacity-50">{datasheetBusy?'Uploading…':'+ Add'}</button></div>
      <input ref={datasheetInputRef} type="file" accept=".pdf,.doc,.docx,.txt,application/pdf" className="hidden" onChange={e=>{const file=e.target.files?.[0];if(file)void addDatasheet(file);e.target.value='';}}/>
      {datasheetError&&<p role="alert" className="text-xs text-status-danger mb-2">{datasheetError}</p>}
      {loadingDatasheets?<p className="text-xs text-text-secondary">Loading…</p>:datasheets.length===0?<p className="text-xs text-text-secondary">No datasheets attached. Add a PDF or document.</p>:<ul className="space-y-1">{datasheets.map(resource=><li key={resource.id} className="flex items-center gap-2 min-w-0"><button type="button" onClick={()=>void openDatasheet(resource)} title={resource.name} className="text-xs text-accent hover:underline truncate text-left flex-1">{resource.name}</button><ExternalLink size={12} className="shrink-0 text-text-secondary"/><button type="button" title={'Remove '+resource.name} aria-label={'Remove '+resource.name} onClick={async()=>{if(!window.confirm('Remove this datasheet?'))return;try{await deleteResource(resource.id);await queryClient.invalidateQueries({queryKey:['resources',{item_id:itemId}]});showToast('Datasheet removed')}catch(e){setDatasheetError(e instanceof Error?e.message:'Unable to remove datasheet')}}} className="text-text-secondary hover:text-status-danger"><X size={13}/></button></li>)}</ul>}
    </div>
    </div>
  );
}
