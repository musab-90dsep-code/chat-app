import { useEffect, useRef, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, doc, setDoc, getDoc, onSnapshot, addDoc, updateDoc, query, where } from 'firebase/firestore';
import { useAuth } from '@/components/AuthProvider';

export type CallStatus = 'idle' | 'ringing' | 'accepted' | 'rejected' | 'ended';
export type CallType = 'video' | 'audio';

export function useWebRTC() {
  const { user } = useAuth();
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [callType, setCallType] = useState<CallType>('video');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const pc = useRef<RTCPeerConnection | null>(null);
  const unsubCallRef = useRef<(() => void) | null>(null);
  const unsubCandidatesRef = useRef<(() => void) | null>(null);

  // Initialize Peer Connection
  const initializePC = () => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    };
    const peerConnection = new RTCPeerConnection(configuration);

    peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    pc.current = peerConnection;
    return peerConnection;
  };

  const getMediaStream = async (type: CallType) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: type === 'video',
        audio: true
      });
      setLocalStream(stream);
      return stream;
    } catch (error) {
      console.error('Error accessing media devices', error);
      return null;
    }
  };

  const cleanup = () => {
    if (unsubCallRef.current) unsubCallRef.current();
    if (unsubCandidatesRef.current) unsubCandidatesRef.current();
    if (pc.current) {
      pc.current.close();
      pc.current = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }
    setLocalStream(null);
    setRemoteStream(null);
    setCallStatus('idle');
    setActiveCallId(null);
    setIncomingCall(null);
  };

  // Listen for incoming calls
  useEffect(() => {
    if (!user) return;
    
    // Fix: query specifically where calleeId == user.uid
    const q = query(collection(db, 'calls'), where('calleeId', '==', user.uid), where('status', '==', 'ringing'));
    const unsub = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const callData = change.doc.data();
        if (change.type === 'added') {
          setIncomingCall({ id: change.doc.id, ...callData });
        }
        if (change.type === 'modified' && callData.status === 'ended') {
          if (activeCallId === change.doc.id || incomingCall?.id === change.doc.id) {
            cleanup();
          }
        }
      });
    }, (err) => console.error(err));

    return () => unsub();
  }, [user, activeCallId]);

  const startCall = async (calleeId: string, type: CallType) => {
    if (!user) return;
    
    const stream = await getMediaStream(type);
    if (!stream) return;

    setCallType(type);
    const peerConnection = initializePC();
    stream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, stream);
    });

    const callDoc = doc(collection(db, 'calls'));
    const callId = callDoc.id;
    setActiveCallId(callId);
    setCallStatus('ringing');

    const callerCandidates = collection(db, `calls/${callId}/callerCandidates`);
    const calleeCandidates = collection(db, `calls/${callId}/calleeCandidates`);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(callerCandidates, {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex
        });
      }
    };

    const offerDescription = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offerDescription);

    const callData = {
      callerId: user.uid,
      calleeId: calleeId,
      status: 'ringing',
      type,
      offer: {
        type: offerDescription.type,
        sdp: offerDescription.sdp,
      },
      createdAt: new Date().getTime()
    };

    await setDoc(callDoc, callData);

    // Listen for answer
    unsubCallRef.current = onSnapshot(callDoc, (snapshot) => {
      const data = snapshot.data();
      if (!data) return;
      if (data.status === 'accepted' && data.answer && !peerConnection.currentRemoteDescription) {
        const answerDescription = new RTCSessionDescription(data.answer);
        peerConnection.setRemoteDescription(answerDescription);
        setCallStatus('accepted');
      } else if (data.status === 'rejected' || data.status === 'ended') {
        cleanup();
      }
    });

    // Listen for remote ICE candidates
    unsubCandidatesRef.current = onSnapshot(calleeCandidates, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const candidate = new RTCIceCandidate(change.doc.data());
          peerConnection.addIceCandidate(candidate);
        }
      });
    });
  };

  const answerCall = async () => {
    if (!incomingCall || !user) return;
    
    const callId = incomingCall.id;
    setActiveCallId(callId);
    setCallType(incomingCall.type);
    setIncomingCall(null);
    setCallStatus('accepted');

    const stream = await getMediaStream(incomingCall.type);
    if (!stream) return;

    const peerConnection = initializePC();
    stream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, stream);
    });

    const callDoc = doc(db, 'calls', callId);
    const callerCandidates = collection(db, `calls/${callId}/callerCandidates`);
    const calleeCandidates = collection(db, `calls/${callId}/calleeCandidates`);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(calleeCandidates, {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex
        });
      }
    };

    const offerDescription = new RTCSessionDescription(incomingCall.offer);
    await peerConnection.setRemoteDescription(offerDescription);

    const answerDescription = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answerDescription);

    await updateDoc(callDoc, {
      answer: { type: answerDescription.type, sdp: answerDescription.sdp },
      status: 'accepted'
    });

    unsubCallRef.current = onSnapshot(callDoc, (snapshot) => {
      const data = snapshot.data();
      if (data?.status === 'ended') {
        cleanup();
      }
    });

    unsubCandidatesRef.current = onSnapshot(callerCandidates, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const candidate = new RTCIceCandidate(change.doc.data());
          peerConnection.addIceCandidate(candidate);
        }
      });
    });
  };

  const rejectCall = async () => {
    if (!incomingCall) return;
    const callDoc = doc(db, 'calls', incomingCall.id);
    await updateDoc(callDoc, { status: 'rejected' });
    setIncomingCall(null);
  };

  const endCall = async () => {
    if (activeCallId) {
      const callDoc = doc(db, 'calls', activeCallId);
      await updateDoc(callDoc, { status: 'ended' });
    }
    cleanup();
  };

  return {
    startCall,
    answerCall,
    rejectCall,
    endCall,
    callStatus,
    incomingCall,
    localStream,
    remoteStream,
    callType
  };
}
