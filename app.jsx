import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore, doc, setDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

// --- Firebase Configuration ---
// IMPORTANT: Replace with your actual Firebase config object
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};
const appId = 'word-web-github'; // Unique ID for this app's data

// Icons (using Lucide)
const ArrowLeft = () => <i data-lucide="arrow-left"></i>;
const LinkIcon = () => <i data-lucide="link"></i>;
const BrainCircuit = () => <i data-lucide="brain-circuit"></i>;
const Sparkles = () => <i data-lucide="sparkles"></i>;
const X = () => <i data-lucide="x"></i>;
const GitBranchPlus = () => <i data-lucide="git-branch-plus"></i>;
const Trash2 = () => <i data-lucide="trash-2"></i>;
const AlertTriangle = () => <i data-lucide="alert-triangle"></i>;


// --- Helper: Formatted Synthesis Result ---
const FormattedSynthesisResult = ({ text }) => {
    if (!text) return null;
    const parts = text.split(/(<keyword>.*?<\/keyword>)/g).filter(part => part);
    return (
        <p className="whitespace-pre-wrap">
            {parts.map((part, index) => {
                if (part.startsWith('<keyword>')) {
                    const keyword = part.substring(9, part.length - 10);
                    return <strong key={index} className="font-bold text-cyan-400">{keyword}</strong>;
                }
                return <span key={index}>{part}</span>;
            })}
        </p>
    );
};

// --- UI Component: Synthesis Modal ---
const SynthesisModal = ({ isOpen, onClose, isLoading, result, onRetry }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in">
            <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl max-w-2xl w-full text-white transform transition-all animate-fade-in-up">
                <div className="flex justify-between items-center p-4 border-b border-slate-700">
                    <div className="flex items-center gap-3"><Sparkles /><h2 className="text-xl font-bold">Synthesized Ideas</h2></div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X /></button>
                </div>
                <div className="p-6 min-h-[250px] max-h-[60vh] overflow-y-auto prose prose-invert prose-lg">
                    {isLoading ? (<div className="flex flex-col items-center justify-center h-full"><BrainCircuit /><p className="mt-4 text-slate-300">Generating connections...</p></div>) 
                    : (<FormattedSynthesisResult text={result} />)}
                </div>
                {result && result.startsWith("Error:") && !isLoading && (<div className="p-4 border-t border-slate-700 flex justify-end"><button onClick={onRetry} className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-500 transition-colors">Try Again</button></div>)}
            </div>
        </div>
    );
};

// --- UI Component: Confirmation Modal ---
const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, children }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in">
            <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl max-w-sm w-full text-white p-6 transform transition-all animate-fade-in-up">
                <div className="flex items-center gap-3 mb-4"><AlertTriangle className="h-8 w-8 text-yellow-400" /><h2 className="text-xl font-bold">{title}</h2></div>
                <p className="text-slate-300 mb-6">{children}</p>
                <div className="flex justify-end gap-4">
                    <button onClick={onClose} className="bg-slate-600 text-white px-4 py-2 rounded-md hover:bg-slate-500 transition-colors">Cancel</button>
                    <button onClick={onConfirm} className="bg-red-700 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors">Confirm</button>
                </div>
            </div>
        </div>
    );
};

// --- Main App Component ---
function App() {
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [nodes, setNodes] = useState([]);
    const [links, setLinks] = useState([]);
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    const [linkingNodeId, setLinkingNodeId] = useState(null);
    const [newNodeText, setNewNodeText] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [isClearModalOpen, setIsClearModalOpen] = useState(false);
    const [synthesisResult, setSynthesisResult] = useState("");
    const [isSynthesizing, setIsSynthesizing] = useState(false);
    const [showSynthesisModal, setShowSynthesisModal] = useState(false);
    const [isExpanding, setIsExpanding] = useState(false);
    const [definitionsCache, setDefinitionsCache] = useState({});
    const [tooltip, setTooltip] = useState({ visible: false, content: '', x: 0, y: 0 });

    const canvasRef = useRef(null);
    const draggingNodeRef = useRef(null);
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const tooltipTimeoutRef = useRef(null);

    const saveToFirestore = useCallback(async (currentNodes, currentLinks) => {
        if (!isAuthReady || !db || !userId) return;
        try {
            const docRef = doc(db, 'artifacts', appId, 'users', userId, 'wordweb', 'main');
            await setDoc(docRef, { nodes: currentNodes, links: currentLinks });
        } catch (error) { console.error("Error saving to Firestore:", error); }
    }, [isAuthReady, db, userId]);

    useEffect(() => {
        try {
            const app = window.firebase.initializeApp(firebaseConfig);
            const auth = getAuth(app);
            setDb(getFirestore(app));
            const unsubscribe = onAuthStateChanged(auth, async user => {
                if (user) {
                    setUserId(user.uid);
                    setIsAuthReady(true);
                } else {
                     signInAnonymously(auth).catch(err => console.error("Anonymous sign-in failed", err));
                }
            });
            return () => unsubscribe();
        } catch (error) { console.error("Firebase init error:", error); setIsLoading(false); }
    }, []);

    useEffect(() => {
        if (!isAuthReady || !db || !userId) return;
        const docRef = doc(db, 'artifacts', appId, 'users', userId, 'wordweb', 'main');
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setNodes(data.nodes || []);
                setLinks(data.links || []);
            } else {
                const initialNodes = [{ id: 'welcome-node', text: 'Welcome!', x: 200, y: 150, expertise: 'Hover over me!' }];
                setNodes(initialNodes);
                saveToFirestore(initialNodes, []);
            }
            setIsLoading(false);
        }, (error) => { console.error("Firestore snapshot error:", error); setIsLoading(false); });
        return () => unsubscribe();
    }, [isAuthReady, db, userId, saveToFirestore]);
    
    useEffect(() => {
        lucide.createIcons();
    });

    const fetchDefinition = useCallback(async (word) => {
        if (definitionsCache[word]) return definitionsCache[word];
        const prompt = `Define the word or concept: "${word}". Provide a concise, one-sentence definition.`;
        // In a real app, you would fetch from your Gemini API backend here.
        // For this standalone file, we'll simulate it.
        const mockDefinition = `A simulated but plausible definition for "${word}".`;
        setDefinitionsCache(prev => ({ ...prev, [word]: mockDefinition }));
        return mockDefinition;
    }, [definitionsCache]);

    const handleSynthesis = async () => {
        // This would call your Gemini backend. Simulating for now.
        setIsSynthesizing(true);
        setShowSynthesisModal(true);
        setTimeout(() => {
             setSynthesisResult("This is a <keyword>simulated</keyword> result showing how different <keyword>ideas</keyword> can connect.");
             setIsSynthesizing(false);
        }, 1500);
    };

    const handleExpandNode = (nodeId) => {
        // This would call your Gemini backend. Simulating for now.
    };

    const addNode = () => {
        if (!newNodeText.trim() || !canvasRef.current) return;
        const { width, height } = canvasRef.current.getBoundingClientRect();
        const newNode = { id: `node-${Date.now()}`, text: newNodeText, x: Math.random()*(width-200)+100, y: Math.random()*(height-100)+50, expertise: '' };
        setNodes(prev => [...prev, newNode]);
        saveToFirestore([...nodes, newNode], links);
        setNewNodeText("");
    };

    const handleClearWeb = () => {
        setNodes([]);
        setLinks([]);
        saveToFirestore([], []);
        setIsClearModalOpen(false);
    };

    // Other handlers (linking, deleting, dragging) remain the same...
    const updateNodeExpertise = (nodeId, expertise) => {
        const updatedNodes = nodes.map(n => n.id === nodeId ? { ...n, expertise } : n);
        setNodes(updatedNodes);
        saveToFirestore(updatedNodes, links);
    };
    const startLinking = (nodeId) => { setLinkingNodeId(nodeId); setSelectedNodeId(null); };
    const createLink = (targetNodeId) => {
        if (linkingNodeId && linkingNodeId !== targetNodeId) {
            const linkExists = links.some(l => (l.from === linkingNodeId && l.to === targetNodeId) || (l.from === targetNodeId && l.to === linkingNodeId));
            if (!linkExists) {
                const updatedLinks = [...links, { from: linkingNodeId, to: targetNodeId }];
                setLinks(updatedLinks);
                saveToFirestore(nodes, updatedLinks);
            }
        }
        setLinkingNodeId(null);
    };
    const deleteNode = (nodeId) => {
        const updatedNodes = nodes.filter(n => n.id !== nodeId);
        const updatedLinks = links.filter(l => l.from !== nodeId && l.to !== nodeId);
        setNodes(updatedNodes);
        setLinks(updatedLinks);
        saveToFirestore(updatedNodes, updatedLinks);
        setSelectedNodeId(null);
    };
    const handleMouseDown = (e, nodeId) => {
        if (linkingNodeId) { createLink(nodeId); return; }
        const node = nodes.find(n => n.id === nodeId);
        if (node) {
            draggingNodeRef.current = nodeId;
            dragOffsetRef.current = { x: e.clientX - node.x, y: e.clientY - node.y };
            setSelectedNodeId(nodeId);
            e.stopPropagation();
        }
    };
    const handleMouseMove = useCallback((e) => {
        if (!draggingNodeRef.current) return;
        const newX = e.clientX - dragOffsetRef.current.x;
        const newY = e.clientY - dragOffsetRef.current.y;
        setNodes(prevNodes => prevNodes.map(n => n.id === draggingNodeRef.current ? { ...n, x: newX, y: newY } : n));
    }, []);
    const handleMouseUp = useCallback(() => {
        if(draggingNodeRef.current) saveToFirestore(nodes, links);
        draggingNodeRef.current = null;
    }, [nodes, links, saveToFirestore]);
    useEffect(() => {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
    }, [handleMouseMove, handleMouseUp]);
    
    const handleNodeMouseEnter = (e, nodeText) => {
        clearTimeout(tooltipTimeoutRef.current);
        tooltipTimeoutRef.current = setTimeout(async () => {
            setTooltip({ visible: true, content: 'Loading...', x: e.clientX, y: e.clientY });
            const definition = await fetchDefinition(nodeText);
            setTooltip(prev => ({ ...prev, visible: true, content: definition, x: e.clientX, y: e.clientY }));
        }, 300);
    };
    const handleNodeMouseLeave = () => {
        clearTimeout(tooltipTimeoutRef.current);
        setTooltip({ visible: false, content: '', x: 0, y: 0 });
    };

    const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null;

    if (isLoading) {
        return (<div className="flex items-center justify-center h-screen bg-slate-900 text-white"><BrainCircuit /><span className="ml-4 text-xl">Loading...</span></div>);
    }

    return (
        <div className="h-screen w-screen bg-slate-900 text-white flex flex-col font-sans overflow-hidden">
            <SynthesisModal isOpen={showSynthesisModal} onClose={() => setShowSynthesisModal(false)} isLoading={isSynthesizing} result={synthesisResult} onRetry={handleSynthesis} />
            <ConfirmationModal isOpen={isClearModalOpen} onClose={() => setIsClearModalOpen(false)} onConfirm={handleClearWeb} title="Clear Web?">Are you sure you want to delete all nodes and links? This action cannot be undone.</ConfirmationModal>
            
            {tooltip.visible && (<div className="fixed p-2 text-sm bg-black/80 text-white rounded-md shadow-lg z-50 pointer-events-none max-w-xs transition-opacity duration-200" style={{ left: tooltip.x + 15, top: tooltip.y + 15 }}>{tooltip.content}</div>)}

            <header className="flex items-center justify-between p-3 bg-slate-800/50 border-b border-slate-700 shadow-lg z-20">
                <div className="flex items-center gap-3"><BrainCircuit /><h1 className="text-2xl font-bold text-slate-100">Word Web</h1></div>
                <div className="flex items-center gap-4">
                    <button onClick={() => setIsClearModalOpen(true)} className="flex items-center gap-2 bg-slate-700 text-slate-300 px-3 py-2 rounded-md hover:bg-red-800 hover:text-white transition-colors"><Trash2 /><span>Clear</span></button>
                    <button onClick={handleSynthesis} disabled={links.length === 0 || isSynthesizing} className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-500 transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed"><Sparkles /><span>Synthesize</span></button>
                    <div className="relative"><input type="text" value={newNodeText} onChange={(e) => setNewNodeText(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && addNode()} placeholder="Add element..." className="bg-slate-700 border border-slate-600 rounded-md py-2 pl-4 pr-16 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500" /><button onClick={addNode} className="absolute right-1 top-1/2 -translate-y-1/2 bg-sky-600 text-white px-3 py-1 rounded-md text-sm hover:bg-sky-500">Add</button></div>
                </div>
            </header>
            
            <main className="flex-grow flex relative">
                <div ref={canvasRef} className={`flex-grow relative overflow-hidden cursor-default ${linkingNodeId ? 'cursor-crosshair' : ''}`} onClick={() => { if (!linkingNodeId) setSelectedNodeId(null); }}>
                    {linkingNodeId && (<div className="absolute top-2 left-1/2 -translate-x-1/2 bg-yellow-400 text-black px-4 py-2 rounded-full text-sm font-semibold z-30 shadow-lg">Select a node to link.</div>)}
                    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-0">
                        <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#4B5563" /></marker></defs>
                        {links.map(link => {
                            const fromNode = nodes.find(n => n.id === link.from); const toNode = nodes.find(n => n.id === link.to); if (!fromNode || !toNode) return null;
                            return (<line key={`${link.from}-${link.to}`} x1={fromNode.x+80} y1={fromNode.y+20} x2={toNode.x+80} y2={toNode.y+20} stroke="#4B5563" strokeWidth="2" markerEnd="url(#arrow)" />);
                        })}
                    </svg>
                    {nodes.map(node => (
                        <div key={node.id} className={`node-container ${ selectedNodeId === node.id ? 'selected' : linkingNodeId === node.id ? 'linking' : '' }`} style={{ left: `${node.x}px`, top: `${node.y}px`}} onMouseDown={(e) => handleMouseDown(e, node.id)} onClick={(e) => { if (linkingNodeId) { e.stopPropagation(); createLink(node.id); } else { e.stopPropagation(); setSelectedNodeId(node.id); }}} onMouseEnter={(e) => handleNodeMouseEnter(e, node.text)} onMouseLeave={handleNodeMouseLeave}>
                           <p className="font-bold text-center text-white break-words">{node.text}</p>
                        </div>
                    ))}
                </div>
                
                <aside className={`side-panel ${selectedNode ? 'open' : ''}`}>
                    {selectedNode && (
                        <div className="p-6 flex flex-col h-full">
                           <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold text-sky-300 truncate pr-2">{selectedNode.text}</h2><button onClick={() => setSelectedNodeId(null)} className="text-slate-400 hover:text-white"><ArrowLeft /></button></div>
                            <div className="flex-grow flex flex-col">
                                <label htmlFor="expertise" className="text-sm font-semibold text-slate-300 mb-2">Expertise / Notes</label>
                                <textarea id="expertise" value={selectedNode.expertise} onChange={(e) => updateNodeExpertise(selectedNode.id, e.text.value)} placeholder="Add your thoughts..." className="flex-grow bg-slate-900 border border-slate-600 rounded-md p-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 w-full resize-none" />
                            </div>
                            <div className="mt-4 pt-4 border-t border-slate-700 flex flex-col gap-3">
                                <button onClick={() => handleExpandNode(selectedNode.id)} disabled={isExpanding} className="w-full flex items-center justify-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-md hover:bg-teal-500 disabled:bg-slate-600"><GitBranchPlus /><span>{isExpanding ? 'Expanding...' : '✨ Expand Idea'}</span></button>
                                <button onClick={() => startLinking(selectedNode.id)} className="w-full flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-500"><LinkIcon /><span>Create Link</span></button>
                                <button onClick={() => deleteNode(selectedNode.id)} className="w-full bg-red-700 text-white px-4 py-2 rounded-md hover:bg-red-600">Delete Node</button>
                            </div>
                        </div>
                    )}
                </aside>
            </main>
        </div>
    );
}

