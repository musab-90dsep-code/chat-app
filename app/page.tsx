'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { db } from '@/lib/firebase';
import { collection, query, onSnapshot, orderBy, serverTimestamp, setDoc, doc, getDoc, addDoc, updateDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '@/lib/errorHandler';
import { useWebRTC } from '@/hooks/useWebRTC';
import { Video, Phone, Send, LogOut, User as UserIcon, ArrowLeft } from 'lucide-react';

export default function AppContent() {
  const { user, login, logout } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    startCall,
    answerCall,
    rejectCall,
    endCall,
    callStatus,
    incomingCall,
    localStream,
    remoteStream,
    callType
  } = useWebRTC();

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
      const usersData: any[] = [];
      snapshot.forEach(doc => {
        if (doc.id !== user.uid) {
          usersData.push({ id: doc.id, ...doc.data() });
        }
      });
      setUsers(usersData);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'users'));

    return () => unsub();
  }, [user]);

  // Load or create chat when user is selected
  useEffect(() => {
    if (!user || !selectedUser) {
      setMessages([]);
      setChatId(null);
      return;
    }
    
    const newChatId = [user.uid, selectedUser.id].sort().join('_');
    setChatId(newChatId);

    const chatRef = doc(db, 'chats', newChatId);
    let unsubMessages: (() => void) | null = null;

    const setupChat = async () => {
      try {
        const snap = await getDoc(chatRef);
        if (!snap.exists()) {
          await setDoc(chatRef, {
            participants: [user.uid, selectedUser.id],
            lastMessage: '',
            lastMessageTime: new Date().getTime()
          });
        }

        // Only start listening for messages after we know the chat document exists
        const messagesQuery = query(
          collection(db, `chats/${newChatId}/messages`), 
          orderBy('createdAt', 'asc')
        );

        unsubMessages = onSnapshot(messagesQuery, (snapshot) => {
          const msgs: any[] = [];
          snapshot.forEach(doc => msgs.push({ id: doc.id, ...doc.data() }));
          setMessages(msgs);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        }, (err) => {
          console.warn('Messages error', err);
        });

      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `chats/${newChatId}`);
      }
    };

    setupChat();

    return () => {
      if (unsubMessages) unsubMessages();
    };
  }, [selectedUser, user]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user || !selectedUser || !chatId) return;

    try {
      const now = new Date().getTime();
      const chatRef = doc(db, 'chats', chatId);
      const chatSnap = await getDoc(chatRef);

      // Ensure chat document exists before sending message
      if (!chatSnap.exists()) {
        await setDoc(chatRef, {
          participants: [user.uid, selectedUser.id],
          lastMessage: newMessage,
          lastMessageTime: now
        });
      }

      await addDoc(collection(db, `chats/${chatId}/messages`), {
        text: newMessage,
        senderId: user.uid,
        createdAt: now
      });

      if (chatSnap.exists()) {
        await updateDoc(chatRef, {
          lastMessage: newMessage,
          lastMessageTime: now
        });
      }

      setNewMessage('');
    } catch (error) {
      console.error('Send error:', error);
      handleFirestoreError(error, OperationType.WRITE, `chats/${chatId}/messages`);
    }
  };

  const [searchQuery, setSearchQuery] = useState('');

  const filteredUsers = users.filter(u => 
    u.displayName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-10 rounded-2xl shadow-xl shadow-slate-200 text-center max-w-sm w-full border border-slate-100">
          <div className="bg-blue-50 text-blue-600 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 transform rotate-3">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">Connect</h1>
          <p className="text-slate-500 mb-8 leading-relaxed">Sign in to start messaging and calling your friends in real-time.</p>
          <button
            onClick={login}
            className="w-full bg-blue-600 text-white rounded-xl py-4 px-6 font-semibold hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-[0.98]"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  // Handle active call window
  if (callStatus === 'ringing' && incomingCall) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center z-50 text-white">
        <div className="text-center animate-in fade-in zoom-in duration-300">
          <div className="w-32 h-32 bg-slate-800 rounded-full mx-auto mb-6 flex items-center justify-center relative">
            <div className="absolute inset-0 rounded-full border-4 border-blue-500 animate-ping opacity-20"></div>
            <Video className="w-12 h-12 text-blue-400" />
          </div>
          <h2 className="text-3xl font-bold mb-2">Incoming Call</h2>
          <p className="text-slate-400 mb-10">Someone is calling you...</p>
          <div className="flex gap-8 justify-center">
            <button onClick={rejectCall} className="bg-red-500 hover:bg-red-600 rounded-full p-6 transition-all hover:scale-110 shadow-lg shadow-red-500/20">
               <LogOut className="w-8 h-8 rotate-180" />
            </button>
            <button onClick={answerCall} className="bg-emerald-500 hover:bg-emerald-600 rounded-full p-6 transition-all hover:scale-110 shadow-lg shadow-emerald-500/20">
               <Phone className="w-8 h-8" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (callStatus === 'accepted' || (callStatus === 'ringing' && !incomingCall)) {
    return (
      <div className="fixed inset-0 bg-slate-950 z-50 flex flex-col items-center justify-center relative overflow-hidden">
        {remoteStream ? (
          <VideoPlayer stream={remoteStream} isLocal={false} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-blue-200 font-medium tracking-wide">CONNECTING...</p>
          </div>
        )}
        
        {localStream && callType === 'video' && (
          <div className="absolute right-6 bottom-28 w-40 md:w-64 aspect-video bg-slate-800 rounded-2xl overflow-hidden border-2 border-slate-700 shadow-2xl ring-4 ring-black/20">
             <VideoPlayer stream={localStream} isLocal={true} className="w-full h-full object-cover" />
          </div>
        )}

        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-6 bg-slate-900/80 p-5 rounded-full backdrop-blur-xl border border-slate-700/50 shadow-2xl">
           <button onClick={endCall} className="bg-red-500 hover:bg-red-600 rounded-full p-5 text-white transition-all active:scale-95 shadow-lg shadow-red-500/30">
             <Phone className="w-7 h-7 rotate-[135deg]" />
           </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden relative font-sans">
      {/* Sidebar */}
      <div className={`${selectedUser ? 'hidden md:flex' : 'flex'} w-full md:w-85 border-r border-slate-200 flex-col bg-white flex-shrink-0 absolute md:static inset-0 z-10 shadow-sm`}>
        <div className="p-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Messages</h1>
          <button onClick={logout} className="p-2.5 text-slate-400 hover:text-red-500 rounded-xl hover:bg-red-50 transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 mb-4">
          <div className="relative">
            <input 
              type="text" 
              placeholder="Search contacts..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-100 border-none rounded-xl py-3 pl-11 text-sm focus:ring-2 focus:ring-blue-500 transition-all"
            />
            <svg className="absolute left-4 top-3.5 text-slate-400" xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>
        </div>
        
        <div className="overflow-y-auto flex-1 px-3 space-y-1">
          {filteredUsers.length > 0 ? (
            filteredUsers.map((u) => (
              <button
                key={u.id}
                onClick={() => setSelectedUser(u)}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl text-left transition-all group ${
                  selectedUser?.id === u.id 
                    ? 'bg-blue-50 border-r-4 border-blue-600' 
                    : 'hover:bg-slate-50'
                }`}
              >
                <div className="relative">
                  {u.photoURL ? (
                    <img src={u.photoURL} alt={u.displayName} className="w-12 h-12 rounded-full border-2 border-white shadow-sm" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center border-2 border-white shadow-sm">
                      <UserIcon className="w-6 h-6 text-slate-400" />
                    </div>
                  )}
                  {u.status === 'online' && (
                    <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full"></div>
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  <div className="flex justify-between items-baseline mb-0.5">
                    <h4 className="font-bold truncate text-slate-900 group-hover:text-blue-600 transition-colors">{u.displayName}</h4>
                    {u.lastSeen && (
                      <span className="text-[10px] text-slate-400 font-medium">
                        {new Date(u.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate italic">
                    {u.status === 'online' ? 'Active now' : 'Away'}
                  </p>
                </div>
              </button>
            ))
          ) : (
            <div className="text-center py-10 px-6">
              <p className="text-slate-400 text-sm">No contacts found yet.</p>
              <p className="text-slate-400 text-xs mt-2">Ask your friends to sign in to start chatting!</p>
            </div>
          )}
        </div>

        {/* User Profile Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex items-center gap-3">
           <img src={user.photoURL || ''} className="w-9 h-9 rounded-full border border-slate-200" alt="Me" />
           <div className="flex-1 min-w-0">
             <p className="text-sm font-bold text-slate-900 truncate">{user.displayName}</p>
             <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">Online</p>
           </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`${!selectedUser ? 'hidden md:flex' : 'flex'} flex-1 flex-col bg-white overflow-hidden absolute md:static inset-0 z-20`}>
        {selectedUser ? (
          <>
            {/* Chat Header */}
            <div className="h-20 border-b border-slate-200 flex items-center justify-between px-4 md:px-8 bg-white/80 backdrop-blur-md">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setSelectedUser(null)}
                  className="md:hidden p-2 text-slate-400 hover:text-blue-600 transition-colors"
                >
                  <ArrowLeft className="w-6 h-6" />
                </button>
                <div className="relative">
                 {selectedUser.photoURL ? (
                    <img src={selectedUser.photoURL} alt={selectedUser.displayName} className="w-11 h-11 rounded-full border-2 border-slate-100" />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center border-2 border-slate-100">
                      <UserIcon className="w-6 h-6 text-slate-400" />
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-lg tracking-tight">{selectedUser.displayName}</h3>
                  <span className={`text-xs font-semibold ${selectedUser.status === 'online' ? 'text-emerald-500' : 'text-slate-400'}`}>
                    {selectedUser.status === 'online' ? 'Active Now' : 'Offline'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => startCall(selectedUser.id, 'audio')}
                  className="p-3 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-all active:scale-95"
                >
                  <Phone className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => startCall(selectedUser.id, 'video')}
                  className="p-3 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-all active:scale-95"
                >
                  <Video className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Messages List */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-50/50">
              <div className="space-y-6 max-w-4xl mx-auto flex flex-col">
                <div className="flex justify-center">
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-200 px-3 py-1 rounded-full uppercase tracking-widest italic">Conversation Started</span>
                </div>
                {messages.map((msg, index) => {
                  const isMe = msg.senderId === user.uid;
                  return (
                    <div key={msg.id || index} className={`flex ${isMe ? 'justify-end' : 'justify-start'} items-end gap-2`}>
                      {!isMe && (
                        <div className="w-7 min-w-[28px] h-7 rounded-full bg-slate-200 overflow-hidden mb-1 border-2 border-white shadow-sm">
                           {selectedUser.photoURL ? <img src={selectedUser.photoURL} alt="" /> : <UserIcon className="p-1 text-slate-400" />}
                        </div>
                      )}
                      <div className={`max-w-[80%] md:max-w-[70%] rounded-2xl px-5 py-3 shadow-sm ${
                        isMe 
                          ? 'bg-blue-600 text-white rounded-br-none shadow-blue-100' 
                          : 'bg-white text-slate-800 rounded-bl-none border border-slate-200'
                      }`}>
                        <p className="text-[15px] leading-relaxed break-words font-medium">{msg.text}</p>
                        <span className={`text-[9px] mt-1.5 block text-right font-bold uppercase tracking-tighter ${isMe ? 'text-blue-200' : 'text-slate-400'}`}>
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input Area */}
            <div className="p-6 bg-white border-t border-slate-200">
              <form onSubmit={sendMessage} className="flex gap-4 max-w-4xl mx-auto items-center">
                <div className="flex-1 relative group">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Write your message..."
                    className="w-full bg-slate-100 rounded-2xl py-4 px-6 outline-none focus:ring-2 ring-blue-500/20 text-slate-800 transition-all font-medium placeholder:text-slate-400"
                  />
                  <div className="absolute inset-y-0 right-4 flex items-center">
                     <button type="button" className="text-slate-300 hover:text-blue-500 transition-colors">
                       <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                     </button>
                  </div>
                </div>
                <button 
                  type="submit"
                  disabled={!newMessage.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white w-14 h-14 rounded-2xl shadow-lg shadow-blue-200 flex items-center justify-center transition-all active:scale-90 disabled:opacity-30 disabled:grayscale"
                >
                  <Send className="w-6 h-6 ml-1" />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
            <div className="w-24 h-24 bg-white rounded-3xl flex items-center justify-center mb-6 shadow-xl shadow-slate-200/50 border border-slate-100 rotate-6">
              <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Select a conversation</h2>
            <p className="mt-3 text-slate-500 font-medium text-sm">Pick a contact from the left and start sharing thoughts!</p>
          </div>
        )}
      </div>
    </div>
  );
}


// Simple video player wrapper component
function VideoPlayer({ stream, isLocal, className }: { stream: MediaStream, isLocal: boolean, className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video 
      ref={videoRef} 
      autoPlay 
      playsInline 
      muted={isLocal} 
      className={className} 
    />
  );
}
