import { useState, KeyboardEvent, ClipboardEvent, useRef, ChangeEvent } from 'react';
import { Send, Plus, X, Image as ImageIcon, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ChatInputProps {
  onSend: (message: string, imageData?: { base64: string; mimeType: string }) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [message, setMessage]         = useState('');
  const [selectedImage, setSelectedImage] = useState<{ base64: string; mimeType: string; preview: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if ((message.trim() || selectedImage) && !disabled) {
      onSend(
        message.trim(),
        selectedImage ? { base64: selectedImage.base64, mimeType: selectedImage.mimeType } : undefined
      );
      setMessage('');
      setSelectedImage(null);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const processImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (file.size > 10 * 1024 * 1024)   { toast.error('Image must be less than 10MB'); return; }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setSelectedImage({ base64: base64String.split(',')[1], mimeType: file.type, preview: base64String });
      toast.success('Image attached');
    };
    reader.readAsDataURL(file);
  };

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImageFile(file);
    e.target.value = '';
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) processImageFile(file);
        return;
      }
    }
  };

  const canSend = !disabled && (!!message.trim() || !!selectedImage);

  return (
    <div className="w-full max-w-3xl mx-auto px-4">
      {/* Image preview */}
      {selectedImage && (
        <div className="mb-2 inline-block relative">
          <img src={selectedImage.preview} alt="Selected" className="max-h-28 rounded-xl border border-border/50" />
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-white rounded-full flex items-center justify-center hover:opacity-80"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Input container */}
      <div className={cn(
        'relative glass rounded-2xl transition-all duration-200',
        !disabled && 'focus-within:border-primary/30 focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.10)]'
      )}>
        <div className="flex items-end gap-2 p-2">
          {/* Attach image */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            title="Attach image (or paste Ctrl+V)"
            className="p-2 rounded-xl hover:bg-accent/40 transition-colors flex-shrink-0 disabled:opacity-40 text-muted-foreground hover:text-foreground"
          >
            {selectedImage ? <ImageIcon className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4" />}
          </button>

          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />

          {/* Text area */}
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={selectedImage ? 'Describe what you want to know...' : 'Ask Kairos anything...'}
            disabled={disabled}
            rows={1}
            id="chat-input"
            className={cn(
              'flex-1 bg-transparent resize-none border-0 outline-none text-sm py-2.5 px-1',
              'placeholder:text-muted-foreground/50 min-h-[40px] max-h-36',
              'scrollbar-thin',
              disabled && 'opacity-40 cursor-not-allowed'
            )}
            style={{ fieldSizing: 'content' } as any}
          />

          {/* Send */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            id="chat-send-btn"
            className={cn(
              'p-2.5 rounded-xl flex-shrink-0 transition-all duration-200',
              canSend
                ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_hsl(var(--primary)/0.4)]'
                : 'text-muted-foreground/40 hover:text-muted-foreground'
            )}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Footer hint */}
      <p className="text-center text-[11px] text-muted-foreground/50 mt-2">
        <Zap className="w-2.5 h-2.5 inline mr-1 text-yellow-400/60" />
        ~0.01 USDC per agent (else 0.0001 XLM)· Kairos can make mistakes
      </p>
    </div>
  );
}
