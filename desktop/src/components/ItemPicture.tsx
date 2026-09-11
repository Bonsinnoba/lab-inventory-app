import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, X, Loader2 } from 'lucide-react';
import { uploadFile, deleteResource, getResourceDownloadUrl } from '../api/resources';
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
    <div className="flex items-start gap-4 mb-5 pb-5 border-b border-border">
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
            onClick={() => removeMutation.mutate()}
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
  );
}
