import React, { useState, useEffect, useRef } from 'react';
import { 
  onAuthStateChanged, 
  signInAnonymously,
  signOut, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc 
} from 'firebase/firestore';
import { auth, db, handleFirestoreError } from './lib/firebase';
import { 
  Chat, 
  Message, 
  UserProfile, 
  OperationType 
} from './types';
import { 
  MessageSquare, 
  Plus, 
  LogOut, 
  Send, 
  Paperclip, 
  Copy, 
  Check, 
  User as UserIcon, 
  Cpu, 
  Loader2, 
  ChevronLeft, 
  ChevronRight,
  Terminal,
  Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';
import { sendMessageStream } from './lib/gemini';

// --- Components ---

const AnimatedText = ({ text }: { text: string }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="prose prose-invert max-w-none prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800"
    >
      <ReactMarkdown>{text}</ReactMarkdown>
    </motion.div>
  );
};

const VortexBackground = () => (
  <div className="fixed inset-0 -z-10 bg-black overflow-hidden">
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-indigo-500/10 rounded-full blur-[120px] animate-pulse" />
    <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[100px]" />
    <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[100px]" />
    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10" />
  </div>
);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        try {
          await signInAnonymously(auth);
        } catch (e) {
          console.error("Anonymous sign in failed", e);
        }
        return;
      }
      
      setUser(u);
      
      // Fetch or create profile
      const userDocRef = doc(db, 'users', u.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        setProfile(userDoc.data() as UserProfile);
      } else {
        const newProfile: UserProfile = {
          uid: u.uid,
          email: u.email || 'anonymous',
          displayName: u.displayName || 'Vortex User',
          createdAt: new Date().toISOString()
        };
        await setDoc(userDocRef, newProfile);
        setProfile(newProfile);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Fetch Chats
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'chats'),
      where('userId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setChats(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Chat)));
    }, error => handleFirestoreError(error, OperationType.LIST, 'chats'));
    return unsubscribe;
  }, [user]);

  // Fetch Messages
  useEffect(() => {
    if (!currentChatId) {
      setMessages([]);
      setErrorMsg(null);
      return;
    }
    const q = query(
      collection(db, 'chats', currentChatId, 'messages'),
      orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message)));
    }, error => handleFirestoreError(error, OperationType.LIST, `chats/${currentChatId}/messages`));
    return unsubscribe;
  }, [currentChatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleLogout = () => signOut(auth);

  const createNewChat = async () => {
    if (!user) return;
    try {
      const docRef = await addDoc(collection(db, 'chats'), {
        userId: user.uid,
        title: 'New Conversation',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setCurrentChatId(docRef.id);
      setErrorMsg(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'chats');
    }
  };

  const handleSend = async (e?: React.FormEvent, fileData?: { name: string, type: string, data: string }) => {
    e?.preventDefault();
    if ((!input.trim() && !fileData) || !user || !currentChatId || isSending) return;

    const messageText = input.trim();
    const currentMessages = [...messages]; // Capture history BEFORE snapshot update
    setInput('');
    setIsSending(true);
    setErrorMsg(null);

    try {
      // Add User Message
      const userMessage: Partial<Message> = {
        chatId: currentChatId,
        userId: user.uid,
        role: 'user',
        content: messageText || (fileData ? `Uploaded file: ${fileData.name}` : ''),
        createdAt: serverTimestamp(),
        attachments: fileData ? [fileData] : []
      };
      
      const messagesPath = `chats/${currentChatId}/messages`;
      try {
        await addDoc(collection(db, 'chats', currentChatId, 'messages'), userMessage);
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, messagesPath);
      }

      try {
        await updateDoc(doc(db, 'chats', currentChatId), { updatedAt: serverTimestamp() });
      } catch (e) {
        handleFirestoreError(e, OperationType.UPDATE, `chats/${currentChatId}`);
      }

      // Build history for Gemini
      // History MUST end with 'model' role to send a new 'user' message
      let historyIdx = currentMessages.length;
      while (historyIdx > 0 && currentMessages[historyIdx - 1].role !== 'model') {
        historyIdx--;
      }
      
      const cleanHistory = currentMessages.slice(0, historyIdx).map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));

      // Start Stream
      let assistantContent = '';
      let assistantMsgRef: any;
      try {
        assistantMsgRef = await addDoc(collection(db, 'chats', currentChatId, 'messages'), {
          chatId: currentChatId,
          userId: user.uid,
          role: 'model',
          content: '',
          createdAt: serverTimestamp()
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, messagesPath);
      }

      const stream = await sendMessageStream(
        messageText || (fileData ? `Analyze this file: ${fileData.name}` : ''), 
        cleanHistory, 
        fileData ? [fileData] : [],
        profile?.customGeminiApiKey
      );

      for await (const chunk of stream) {
        assistantContent += chunk.text;
        try {
          await updateDoc(assistantMsgRef, { content: assistantContent });
        } catch (e) {
          handleFirestoreError(e, OperationType.UPDATE, `${messagesPath}/${assistantMsgRef.id}`);
        }
      }

    } catch (error: any) {
      console.error("Chat error", error);
      const msg = error?.message || String(error);
      setErrorMsg(msg);

      if (msg.toLowerCase().includes("api key") || msg.includes("403") || msg.includes("400")) {
        setIsApiKeyModalOpen(true);
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64Data = event.target?.result as string;
      handleSend(undefined, {
        name: file.name,
        type: file.type,
        data: base64Data
      });
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset
  };

  const saveApiKey = async () => {
    if (!user || !tempApiKey.trim()) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        customGeminiApiKey: tempApiKey.trim()
      });
      setProfile(prev => prev ? { ...prev, customGeminiApiKey: tempApiKey.trim() } : null);
      setIsApiKeyModalOpen(false);
      setTempApiKey('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      <VortexBackground />

      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 300 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        className="bg-zinc-900/50 backdrop-blur-xl border-r border-zinc-800 flex flex-col relative overflow-hidden"
      >
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2 font-black text-xl tracking-tighter">
            <Cpu className="w-6 h-6 text-indigo-500" />
            <span>VORTEX</span>
          </div>
          <button 
            onClick={createNewChat}
            className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-indigo-400"
            title="New Chat"
            id="new-chat-btn"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {chats.map(chat => (
            <button
              key={chat.id}
              onClick={() => setCurrentChatId(chat.id)}
              className={cn(
                "w-full text-left p-3 rounded-xl flex items-center gap-3 transition-all",
                currentChatId === chat.id ? "bg-indigo-600/20 text-indigo-100 ring-1 ring-indigo-500/50" : "hover:bg-zinc-800 text-zinc-400"
              )}
              id={`chat-item-${chat.id}`}
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <span className="truncate text-sm font-medium">{chat.title}</span>
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-800 bg-zinc-900/80">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-indigo-600/20 flex items-center justify-center border border-indigo-500/30">
              <Cpu className="w-5 h-5 text-indigo-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">Vortex Node</p>
              <p className="text-[10px] text-zinc-500 truncate font-mono uppercase">ID: {user.uid.slice(0, 8)}</p>
            </div>
          </div>
          <button 
            onClick={() => setIsApiKeyModalOpen(true)}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-bold transition-all border border-zinc-700 hover:border-indigo-500/50"
            id="api-key-settings"
          >
            <Key className="w-4 h-4 text-indigo-500" />
            Activation Key Settings
          </button>
        </div>
      </motion.aside>

      {/* Toggle Sidebar */}
      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-6 h-12 bg-zinc-800 border-r border-zinc-700 hover:bg-zinc-700 flex items-center justify-center rounded-r-lg transition-all"
        style={{ left: isSidebarOpen ? 300 : 0 }}
        id="sidebar-toggle"
      >
        {isSidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {!currentChatId ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center mb-6 border border-zinc-800">
              <Terminal className="w-10 h-10 text-indigo-500" />
            </div>
            <h2 className="text-3xl font-bold mb-4 tracking-tight">Initiate Sequence</h2>
            <p className="text-zinc-400 mb-8 max-w-sm">
              Select an existing transmission or start a new high-bandwidth session with Vortex AI.
            </p>
            <button 
              onClick={createNewChat}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold transition-all flex items-center gap-2 shadow-xl shadow-indigo-600/20"
              id="start-new-chat-center"
            >
              <Plus className="w-5 h-5" />
              New Conversation
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <header className="h-16 border-b border-zinc-800 flex items-center px-6 bg-zinc-950/50 backdrop-blur-md">
              <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">
                Channel: <span className="text-zinc-100">{chats.find(c => c.id === currentChatId)?.title}</span>
              </h2>
            </header>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8">
              {messages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={cn(
                    "flex flex-col max-w-4xl mx-auto",
                    msg.role === 'user' ? "items-end" : "items-start"
                  )}
                  id={`message-${msg.id}`}
                >
                  <div className={cn(
                    "group relative p-4 rounded-2xl md:p-6",
                    msg.role === 'user' 
                      ? "bg-indigo-600 text-white rounded-tr-none ml-12" 
                      : "bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-tl-none mr-12"
                  )}>
                    {msg.role === 'model' && (
                      <div className="absolute -top-6 left-0 text-[10px] font-bold uppercase tracking-widest text-indigo-500 flex items-center gap-1">
                        <Cpu className="w-3 h-3" />
                        Vortex System Output
                      </div>
                    )}
                    
                    <AnimatedText text={msg.content} />

                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {msg.attachments.map((file, idx) => (
                          <div key={idx} className="flex items-center gap-2 p-2 bg-black/30 rounded-lg text-xs border border-white/10">
                            <Paperclip className="w-3 h-3" />
                            <span>{file.name}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <button 
                      onClick={() => copyToClipboard(msg.content, msg.id)}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-zinc-800/50 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-700"
                      id={`copy-btn-${msg.id}`}
                    >
                      {copiedId === msg.id ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ))}
              {isSending && (
                <div className="flex flex-col items-start max-w-4xl mx-auto">
                  <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl rounded-tl-none animate-pulse flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
                    <span className="text-sm font-medium text-zinc-400">Processing stream...</span>
                  </div>
                </div>
              )}
              {errorMsg && (
                <div className="max-w-4xl mx-auto mb-4 p-4 bg-red-900/20 border border-red-500/50 rounded-xl text-red-200 text-sm flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <p><strong>System Error:</strong> {errorMsg}</p>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 md:p-8 bg-gradient-to-t from-zinc-950 to-transparent">
              <form 
                onSubmit={handleSend}
                className="max-w-4xl mx-auto relative group"
              >
                <div className="relative flex items-center bg-zinc-900 border border-zinc-800 rounded-2xl focus-within:ring-2 focus-within:ring-indigo-500/50 focus-within:border-indigo-500/50 transition-all shadow-2xl">
                  <label 
                    className="p-4 hover:text-indigo-400 cursor-pointer transition-colors"
                    id="file-upload-label"
                  >
                    <Paperclip className="w-6 h-6" />
                    <input type="file" className="hidden" onChange={handleFileUpload} />
                  </label>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Input command..."
                    className="flex-1 bg-transparent border-none focus:ring-0 py-4 px-2 max-h-32 min-h-[56px] resize-none text-zinc-100 placeholder-zinc-600"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    disabled={isSending || (!input.trim())}
                    className={cn(
                      "m-2 p-3 rounded-xl transition-all flex items-center justify-center",
                      input.trim() ? "bg-indigo-600 text-white hover:bg-indigo-500" : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                    )}
                    id="send-button"
                  >
                    {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  </button>
                </div>
              </form>
              <p className="text-[10px] text-center mt-4 text-zinc-600 font-bold uppercase tracking-[0.2em]">
                Secure Uplink Established | Version 1.0.4-Vortex
              </p>
            </div>
          </>
        )}
      </main>

      {/* API Key Modal */}
      <AnimatePresence>
        {isApiKeyModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setIsApiKeyModalOpen(false)}
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 p-8 rounded-3xl shadow-2xl"
            >
              <div className="w-16 h-16 bg-indigo-600/20 rounded-2xl flex items-center justify-center mb-6">
                <Key className="w-8 h-8 text-indigo-500" />
              </div>
              <h3 className="text-2xl font-bold mb-2">Vortex Activation</h3>
              <p className="text-zinc-400 text-sm mb-6">
                Please enter your Google Gemini API key to activate advanced features. 
                This key will be stored securely and only used for your requests.
              </p>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 block">
                    API Secret Key
                  </label>
                  <input 
                    type="password"
                    value={tempApiKey}
                    onChange={(e) => setTempApiKey(e.target.value)}
                    placeholder="AIza..."
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all font-mono"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button 
                    onClick={() => setIsApiKeyModalOpen(false)}
                    className="flex-1 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={saveApiKey}
                    disabled={!tempApiKey.trim()}
                    className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl font-bold transition-all shadow-lg shadow-indigo-600/20"
                  >
                    Activate
                  </button>
                </div>
              </div>

              <p className="mt-6 text-[10px] text-zinc-500 text-center uppercase tracking-widest leading-relaxed">
                Keys remain private to your uplink session. <br/>
                Vortex AI does not store raw keys outside your profile.
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
