import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { toast } from 'sonner';
import { useWallet } from './WalletContext';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface Message {
    id: string;
    content: string;
    isUser: boolean;
    timestamp: Date;
    escrowId?: string;
    txHash?: string;
    txHashes?: Record<string, string>;
    imagePreview?: string;
    agentsUsed?: string[];
    partial?: boolean;
}

export interface ChatSession {
    id: string;
    wallet_address: string;
    title: string;
    created_at: string;
    updated_at: string;
}

interface ChatContextType {
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    clearChat: () => void;
    sessions: ChatSession[];
    currentSessionId: string | null;
    loadSession: (sessionId: string) => Promise<void>;
    createNewSession: (options?: { clearMessages?: boolean }) => Promise<string | null>;
    deleteSession: (sessionId: string) => Promise<void>;
    renameSession: (sessionId: string, title: string) => Promise<void>;
    refreshSessions: () => Promise<void>;
    saveMessageToDb: (message: Message) => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'arc-chat-current-session';

export function ChatProvider({ children }: { children: ReactNode }) {
    const { address, isConnected } = useWallet();
    const [messages, setMessages] = useState<Message[]>([]);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

    // Load sessions when wallet connects
    useEffect(() => {
        if (isConnected && address) {
            refreshSessions();
            // Restore last session if saved
            const savedSessionId = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (savedSessionId) {
                loadSession(savedSessionId);
            }
        } else {
            setSessions([]);
            setMessages([]);
            setCurrentSessionId(null);
        }
    }, [isConnected, address]);

    // Save current session ID to localStorage
    useEffect(() => {
        if (currentSessionId) {
            localStorage.setItem(LOCAL_STORAGE_KEY, currentSessionId);
        }
    }, [currentSessionId]);

    const refreshSessions = useCallback(async () => {
        if (!address) return;

        try {
            const res = await fetch(`${API_BASE_URL}/chat/sessions?wallet=${address}`);
            const data = await res.json();
            if (data.success) {
                setSessions(data.sessions);
            }
        } catch (e) {
            console.error('Failed to load sessions:', e);
        }
    }, [address]);

    const loadSession = useCallback(async (sessionId: string) => {
        try {
            const res = await fetch(`${API_BASE_URL}/chat/sessions/${sessionId}/messages`);
            const data = await res.json();
            if (data.success) {
                setMessages(data.messages.map((m: any) => ({
                    id: m.id,
                    content: m.content,
                    isUser: m.is_user,
                    timestamp: new Date(m.timestamp),
                    escrowId: m.escrow_id,
                    txHash: m.tx_hash,
                    txHashes: m.tx_hashes,
                    imagePreview: m.image_preview,
                    agentsUsed: m.agents_used,
                })));
                setCurrentSessionId(sessionId);
            }
        } catch (e) {
            console.error('Failed to load session:', e);
        }
    }, []);

    const createNewSession = useCallback(async (options?: { clearMessages?: boolean }) => {
        if (!address) {
            toast.error('Connect wallet to start a chat');
            return null;
        }

        const shouldClearMessages = options?.clearMessages !== false; // default true

        try {
            const res = await fetch(`${API_BASE_URL}/chat/sessions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: address }),
            });
            const data = await res.json();
            if (data.success) {
                setCurrentSessionId(data.session.id);
                if (shouldClearMessages) {
                    setMessages([]);
                    toast.success('New chat started');
                }
                await refreshSessions();
                return data.session.id;
            }
        } catch (e) {
            console.error('Failed to create session:', e);
            toast.error('Failed to create new chat');
        }
        return null;
    }, [address, refreshSessions]);

    const deleteSession = useCallback(async (sessionId: string) => {
        if (!address) return;

        // Optimistic update: Remove from UI immediately
        const previousSessions = [...sessions];
        setSessions(prev => prev.filter(s => s.id !== sessionId));
        if (currentSessionId === sessionId) {
            setCurrentSessionId(null);
            setMessages([]);
        }

        try {
            const res = await fetch(`${API_BASE_URL}/chat/sessions/${sessionId}?wallet=${address}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Delete failed');
            toast.success('Chat deleted');
        } catch (e) {
            console.error('Failed to delete session:', e);
            toast.error('Failed to delete chat');
            setSessions(previousSessions); // Rollback
        }
    }, [address, currentSessionId, sessions]);

    const renameSession = useCallback(async (sessionId: string, title: string) => {
        // Optimistic update: Update title immediately
        const previousSessions = [...sessions];
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title } : s));

        try {
            const res = await fetch(`${API_BASE_URL}/chat/sessions/${sessionId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title }),
            });
            if (!res.ok) throw new Error('Rename failed');
            toast.success('Chat renamed');
        } catch (e) {
            console.error('Failed to rename session:', e);
            toast.error('Failed to rename chat');
            setSessions(previousSessions); // Rollback
        }
    }, [sessions]);

    const saveMessageToDb = useCallback(async (message: Message) => {
        if (!currentSessionId) return;

        try {
            await fetch(`${API_BASE_URL}/chat/sessions/${currentSessionId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: message.id,
                    content: message.content,
                    is_user: message.isUser,
                    escrow_id: message.escrowId,
                    tx_hash: message.txHash,
                    tx_hashes: message.txHashes,
                    image_preview: message.imagePreview,
                }),
            });
            // Refresh sessions to update titles
            refreshSessions();
        } catch (e) {
            console.error('Failed to save message:', e);
        }
    }, [currentSessionId, refreshSessions]);

    const clearChat = useCallback(async () => {
        if (currentSessionId) {
            try {
                await fetch(`${API_BASE_URL}/chat/sessions/${currentSessionId}/messages`, {
                    method: 'DELETE',
                });
            } catch (e) {
                console.error('Failed to clear messages:', e);
            }
        }
        setMessages([]);
        toast.success('Chat cleared');
    }, [currentSessionId]);

    return (
        <ChatContext.Provider value={{
            messages,
            setMessages,
            clearChat,
            sessions,
            currentSessionId,
            loadSession,
            createNewSession,
            deleteSession,
            renameSession,
            refreshSessions,
            saveMessageToDb
        }}>
            {children}
        </ChatContext.Provider>
    );
}

export function useChatContext() {
    const context = useContext(ChatContext);
    if (context === undefined) {
        throw new Error('useChatContext must be used within a ChatProvider');
    }
    return context;
}
