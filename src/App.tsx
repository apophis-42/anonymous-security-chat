import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  MessageSquare, 
  Lock, 
  Unlock, 
  Plus, 
  Trash2, 
  Send, 
  Image as ImageIcon, 
  Mic, 
  MicOff, 
  User, 
  ArrowLeft,
  Shield,
  Eye,
  EyeOff,
  Loader2,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { deriveKey, encryptData, decryptData, hashPassword } from './lib/crypto';
import { cn } from './lib/utils';

// Types
interface Room {
  id: string;
  name: string;
  passwordProtected: boolean;
  userCount: number;
}

interface Message {
  id: string;
  sender: string;
  content: string; // Encrypted
  type: 'text' | 'image' | 'audio';
  timestamp: number;
}

const App: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [nickname, setNickname] = useState<string>(localStorage.getItem('anon_nickname') || '');
  const [isNicknameSet, setIsNicknameSet] = useState(!!nickname);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<{ id: string; name: string; isCreator: boolean } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [roomKey, setRoomKey] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Form states
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [messageInput, setMessageInput] = useState('');
  
  // Media states
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [showDestroyConfirm, setShowDestroyConfirm] = useState(false);
  const [roomDestroyedMessage, setRoomDestroyedMessage] = useState(false);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('rooms-list', (list: Room[]) => {
      setRooms(list);
    });

    newSocket.on('room-created', ({ roomId, creatorToken }: { roomId: string; creatorToken: string }) => {
      setShowCreateModal(false);
      setIsLoading(false);
      
      const tokens = JSON.parse(localStorage.getItem('anon_creator_tokens') || '{}');
      tokens[roomId] = creatorToken;
      localStorage.setItem('anon_creator_tokens', JSON.stringify(tokens));

      const key = newRoomPassword ? deriveKey(newRoomPassword) : deriveKey(roomId);
      setRoomKey(key);
      newSocket.emit('join-room', { 
        roomId, 
        passwordHash: newRoomPassword ? hashPassword(newRoomPassword) : null,
        creatorToken
      });
    });

    newSocket.on('joined-room', (roomData: { id: string; name: string; isCreator: boolean }) => {
      setCurrentRoom(roomData);
      setShowPasswordModal(null);
      setIsLoading(false);
    });

    newSocket.on('message-history', (history: Message[]) => {
      setMessages(history);
    });

    newSocket.on('new-message', (msg: Message) => {
      setMessages(prev => [...prev, msg]);
    });

    newSocket.on('room-destroyed', () => {
      setRoomDestroyedMessage(true);
      setTimeout(() => {
        setRoomDestroyedMessage(false);
        setCurrentRoom(null);
        setMessages([]);
        setRoomKey('');
      }, 3000);
    });

    newSocket.on('error', (err: string) => {
      setError(err);
      setIsLoading(false);
      setTimeout(() => setError(null), 3000);
    });

    newSocket.emit('get-rooms');

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSetNickname = (e: React.FormEvent) => {
    e.preventDefault();
    if (nickname.trim()) {
      localStorage.setItem('anon_nickname', nickname);
      setIsNicknameSet(true);
    }
  };

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    setIsLoading(true);
    socket?.emit('create-room', { 
      name: newRoomName, 
      passwordHash: newRoomPassword ? hashPassword(newRoomPassword) : null 
    });
  };

  const handleJoinRoom = (roomId: string, isProtected: boolean) => {
    const tokens = JSON.parse(localStorage.getItem('anon_creator_tokens') || '{}');
    const creatorToken = tokens[roomId] || null;

    if (isProtected) {
      setShowPasswordModal(roomId);
    } else {
      setIsLoading(true);
      const key = deriveKey(roomId);
      setRoomKey(key);
      socket?.emit('join-room', { roomId, passwordHash: null, creatorToken });
    }
  };

  const handlePasswordJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showPasswordModal) return;
    setIsLoading(true);
    
    const tokens = JSON.parse(localStorage.getItem('anon_creator_tokens') || '{}');
    const creatorToken = tokens[showPasswordModal] || null;

    const key = deriveKey(joinPassword);
    setRoomKey(key);
    socket?.emit('join-room', { 
      roomId: showPasswordModal, 
      passwordHash: hashPassword(joinPassword),
      creatorToken
    });
  };

  const sendMessage = (content: string, type: 'text' | 'image' | 'audio' = 'text') => {
    if (!currentRoom || !roomKey) return;
    
    const encryptedContent = encryptData(content, roomKey);
    socket?.emit('send-message', {
      roomId: currentRoom.id,
      message: {
        sender: nickname,
        content: encryptedContent,
        type
      }
    });
    setMessageInput('');
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        sendMessage(reader.result as string, 'image');
      };
      reader.readAsDataURL(file);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorder.current = recorder;
      audioChunks.current = [];

      recorder.ondataavailable = (e) => {
        audioChunks.current.push(e.data);
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          sendMessage(reader.result as string, 'audio');
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Erro ao acessar microfone:", err);
      setError("Permissão de microfone negada");
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
    setIsRecording(false);
  };

  const confirmDestroyRoom = () => {
    if (currentRoom?.isCreator) {
      const tokens = JSON.parse(localStorage.getItem('anon_creator_tokens') || '{}');
      const creatorToken = tokens[currentRoom.id];
      socket?.emit('destroy-room', { roomId: currentRoom.id, creatorToken });
      setShowDestroyConfirm(false);
    }
  };

  if (!isNicknameSet) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-zinc-900 border border-zinc-800 p-8 rounded-2xl shadow-2xl"
        >
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-orange-500/10 rounded-full">
              <Shield className="w-12 h-12 text-orange-500" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-center mb-2">AnonChat</h1>
          <p className="text-zinc-400 text-center mb-8">Escolha um apelido para começar. Sem e-mail, sem rastros.</p>
          
          <form onSubmit={handleSetNickname} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-500 mb-1 uppercase tracking-wider">Apelido</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
                <input 
                  type="text" 
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Ex: Fantasma_99"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                  maxLength={20}
                  required
                />
              </div>
            </div>
            <button 
              type="submit"
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-orange-500/20"
            >
              Entrar Anonimamente
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* Header */}
      <header className="h-16 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md flex items-center justify-between px-4 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          {currentRoom ? (
            <button 
              onClick={() => setCurrentRoom(null)}
              className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : (
            <div className="p-2 bg-orange-500/10 rounded-lg">
              <Shield className="w-6 h-6 text-orange-500" />
            </div>
          )}
          <div>
            <h2 className="font-bold text-lg leading-tight">
              {currentRoom ? currentRoom.name : "Salas de Chat"}
            </h2>
            <p className="text-xs text-zinc-500 flex items-center gap-1">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              {nickname} (Anônimo)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {currentRoom?.isCreator && (
            <button 
              onClick={() => setShowDestroyConfirm(true)}
              className="p-2 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
              title="Destruir Sala"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
          {!currentRoom && (
            <button 
              onClick={() => setShowCreateModal(true)}
              className="bg-orange-500 hover:bg-orange-600 p-2 rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {roomDestroyedMessage ? (
            <motion.div 
              key="destroyed-msg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex flex-col items-center justify-center text-center p-6"
            >
              <div className="p-4 bg-red-500/10 rounded-full mb-4">
                <Trash2 className="w-12 h-12 text-red-500" />
              </div>
              <h3 className="text-xl font-bold text-red-500 mb-2">Sala Destruída</h3>
              <p className="text-zinc-400">O criador encerrou esta sessão. Todos os dados foram apagados da memória.</p>
            </motion.div>
          ) : !currentRoom ? (
            <motion.div 
              key="room-list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full overflow-y-auto p-4 space-y-3"
            >
              {rooms.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-4">
                  <MessageSquare className="w-16 h-16 opacity-20" />
                  <p>Nenhuma sala ativa no momento.</p>
                  <button 
                    onClick={() => setShowCreateModal(true)}
                    className="text-orange-500 hover:underline"
                  >
                    Crie a primeira sala
                  </button>
                </div>
              ) : (
                rooms.map((room) => (
                  <button
                    key={room.id}
                    onClick={() => handleJoinRoom(room.id, room.passwordProtected)}
                    className="w-full bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex items-center justify-between hover:border-zinc-700 hover:bg-zinc-800/50 transition-all group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-zinc-800 rounded-lg group-hover:bg-zinc-700 transition-colors">
                        {room.passwordProtected ? <Lock className="w-5 h-5 text-orange-500" /> : <Unlock className="w-5 h-5 text-zinc-500" />}
                      </div>
                      <div className="text-left">
                        <h3 className="font-bold">{room.name}</h3>
                        <p className="text-xs text-zinc-500">{room.userCount} usuários ativos</p>
                      </div>
                    </div>
                    <div className="text-zinc-600 group-hover:text-zinc-400">
                      <ArrowLeft className="w-5 h-5 rotate-180" />
                    </div>
                  </button>
                ))
              )}
            </motion.div>
          ) : (
            <motion.div 
              key="chat-room"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full flex flex-col"
            >
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg) => {
                  const decrypted = decryptData(msg.content, roomKey);
                  const isOwn = msg.sender === nickname;
                  
                  return (
                    <div key={msg.id} className={cn("flex flex-col", isOwn ? "items-end" : "items-start")}>
                      <span className="text-[10px] text-zinc-500 mb-1 px-1">{msg.sender}</span>
                      <div className={cn(
                        "max-w-[85%] rounded-2xl p-3 shadow-sm",
                        isOwn ? "bg-orange-500 text-white rounded-tr-none" : "bg-zinc-800 text-zinc-100 rounded-tl-none"
                      )}>
                        {msg.type === 'text' && <p className="text-sm break-words">{decrypted}</p>}
                        {msg.type === 'image' && (
                          <img 
                            src={decrypted} 
                            alt="Shared" 
                            className="rounded-lg max-w-full h-auto cursor-pointer" 
                            referrerPolicy="no-referrer"
                            onClick={() => window.open(decrypted, '_blank')}
                          />
                        )}
                        {msg.type === 'audio' && (
                          <audio controls src={decrypted} className="max-w-full h-8 brightness-90 contrast-125" />
                        )}
                        <span className="text-[9px] opacity-50 block mt-1 text-right">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Input Area */}
              <div className="p-4 bg-zinc-900 border-t border-zinc-800">
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 text-zinc-400 hover:text-orange-500 transition-colors"
                  >
                    <ImageIcon className="w-5 h-5" />
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/*" 
                    onChange={handleImageUpload}
                  />
                  
                  <div className="flex-1 relative">
                    <input 
                      type="text"
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && messageInput.trim() && sendMessage(messageInput)}
                      placeholder="Mensagem criptografada..."
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-full py-2 px-4 pr-10 focus:outline-none focus:ring-1 focus:ring-orange-500 transition-all text-sm"
                    />
                    <button 
                      onClick={() => messageInput.trim() && sendMessage(messageInput)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-orange-500"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>

                  <button 
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onTouchStart={startRecording}
                    onTouchEnd={stopRecording}
                    className={cn(
                      "p-3 rounded-full transition-all",
                      isRecording ? "bg-red-500 animate-pulse scale-110" : "bg-zinc-800 text-zinc-400 hover:text-orange-500"
                    )}
                  >
                    {isRecording ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5" />}
                  </button>
                </div>
                {isRecording && <p className="text-[10px] text-red-500 text-center mt-2 font-bold uppercase tracking-widest">Gravando Áudio...</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold">Criar Nova Sala</h3>
                <button onClick={() => setShowCreateModal(false)} className="text-zinc-500 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <form onSubmit={handleCreateRoom} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Nome da Sala</label>
                  <input 
                    type="text"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Ex: Assuntos Aleatórios"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Senha (Opcional)</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                    <input 
                      type="password"
                      value={newRoomPassword}
                      onChange={(e) => setNewRoomPassword(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="Deixe vazio para sala pública"
                    />
                  </div>
                </div>
                <button 
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Criar Sala Segura"}
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {showPasswordModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold">Sala Protegida</h3>
                <button onClick={() => setShowPasswordModal(null)} className="text-zinc-500 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <p className="text-zinc-400 text-sm mb-6">Esta sala exige uma senha para descriptografar as mensagens.</p>
              <form onSubmit={handlePasswordJoin} className="space-y-4">
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                  <input 
                    type="password"
                    value={joinPassword}
                    onChange={(e) => setJoinPassword(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Digite a senha"
                    autoFocus
                    required
                  />
                </div>
                <button 
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Entrar na Sala"}
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {showDestroyConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm bg-zinc-900 border border-red-500/30 p-8 rounded-2xl shadow-2xl text-center"
            >
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-red-500/10 rounded-full">
                  <Trash2 className="w-8 h-8 text-red-500" />
                </div>
              </div>
              <h3 className="text-xl font-bold mb-2">Destruir Tudo?</h3>
              <p className="text-zinc-400 text-sm mb-8">
                Esta ação é irreversível. A sala e todas as mensagens serão apagadas da memória do servidor imediatamente.
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={confirmDestroyRoom}
                  className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-xl transition-all"
                >
                  Sim, Destruir Agora
                </button>
                <button 
                  onClick={() => setShowDestroyConfirm(false)}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold py-3 rounded-xl transition-all"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-full shadow-lg z-50 font-bold text-sm"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      {!currentRoom && (
        <footer className="p-4 text-center text-[10px] text-zinc-600 uppercase tracking-[0.2em]">
          Criptografia AES-256 de Ponta a Ponta Ativada
        </footer>
      )}
    </div>
  );
};

export default App;
