import { useState, useCallback } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { useChatContext, Message } from '@/contexts/ChatContext';
import { toast } from 'sonner';

/**
 * 🛠️ Kairos: Stellar-Native Chat Hook
 * Ported from legacy EVM/MetaMask/Viem to Stellar x402 Economy.
 */

export interface ImageData {
  base64: string;
  mimeType: string;
}

const COST_PER_MESSAGE = 0.03;
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function useChat() {
  const { messages, setMessages, clearChat, currentSessionId, createNewSession, saveMessageToDb } = useChatContext();
  const [isTyping, setIsTyping] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const { isConnected, address, balance, refreshBalance } = useWallet();

  const sendMessage = useCallback(async (content: string, imageData?: ImageData) => {
    if (!isConnected || !address) {
      toast.error('Please connect your Stellar wallet first');
      return;
    }

    // x402 flow note:
    // This frontend now trusts the backend to handle the "gasless" negotiation.
    // The backend's /query endpoint will use the user's Stellar identity
    // to track usage and sponsorship.

    // Add user message immediately
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      content: content || (imageData ? '[Image attached]' : ''),
      isUser: true,
      timestamp: new Date(),
      imagePreview: imageData ? `data:${imageData.mimeType};base64,${imageData.base64}` : undefined,
    };
    setMessages(prev => [...prev, userMessage]);

    // Create session if none exists
    if (!currentSessionId) {
      await createNewSession({ clearMessages: false });
    }

    // Step 1: Send query to Stellar-integrated backend
    setIsTyping(true);
    setIsPaying(true); // Frontend "payment pulse" indicator

    try {
      // Build conversation history for context
      const conversationHistory = messages.map(m => ({
        role: m.isUser ? 'user' : 'model',
        content: m.content,
      }));

      console.log(`[Stellar x402] Querying backend for user: ${address}`);

      const requestId = `ai-${Date.now()}`;
      const response = await fetch(`${API_BASE_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: content,
          userAddress: address, // Used for x402 identity and sponsorship
          requestId,
          imageData: imageData ? { base64: imageData.base64, mimeType: imageData.mimeType } : undefined,
          conversationHistory,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Backend query failed');
      }

      // Add AI response
      const aiMessage: Message = {
        id: requestId,
        content: data.response,
        isUser: false,
        timestamp: new Date(),
        agentsUsed: data.agentsUsed,
        txHashes: data.x402Transactions,
        partial: !!data.partial,
      };

      setMessages(prev => [...prev, aiMessage]);

      // Fast receipts: poll briefly for real tx hashes without slowing responses.
      if (data?.agentsUsed?.length) {
        const start = Date.now();
        const maxMs = 20000;
        const poll = async () => {
          if (Date.now() - start > maxMs) return;
          try {
            const r = await fetch(`${API_BASE_URL}/receipts/${requestId}`);
            const j = await r.json();
            const receipts = j?.receipts || {};
            if (receipts && Object.keys(receipts).length > 0) {
              setMessages(prev =>
                prev.map(m =>
                  m.id === requestId
                    ? { ...m, txHashes: { ...(m.txHashes || {}), ...receipts } }
                    : m
                )
              );
              return;
            }
          } catch {}
          setTimeout(poll, 750);
        };
        setTimeout(poll, 500);
      }

      // Reset loading states immediately after message is added to UI
      setIsTyping(false);
      setIsPaying(false);

      // Save in-order to avoid message inversion in persisted chat history
      void (async () => {
        await saveMessageToDb(userMessage);
        await saveMessageToDb(aiMessage);
      })();

      // Refresh balance if needed (sponsorship may have changed it)
      if (refreshBalance) refreshBalance();

    } catch (error) {
      console.error('[Stellar] Chat error:', error);
      toast.error(`Error: ${(error as Error).message}`);

      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        content: `Encountered an error: ${(error as Error).message}. Please try again.`,
        isUser: false,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      setIsTyping(false);
      setIsPaying(false);
    }
  }, [isConnected, address, balance, refreshBalance, messages, setMessages, currentSessionId, createNewSession, saveMessageToDb]);

  return { messages, isTyping, isPaying, sendMessage, clearChat };
}

export type { Message } from '@/contexts/ChatContext';
