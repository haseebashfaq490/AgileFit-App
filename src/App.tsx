/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  Target, Activity, Zap, Play, Clock, CheckCircle2, 
  ChevronRight, Info, LayoutDashboard, ListTodo, 
  CalendarDays, Trophy, BrainCircuit, Dumbbell, 
  X, Check, Orbit, Sparkles, Settings, Moon, Sun, Key, Download
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, BarChart, Bar 
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';
import { generateEpicBacklog, planSprint, completeSprintRetro } from './services/geminiService';
import * as XLSX from 'xlsx';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
type WorkoutStatus = 'backlog' | 'sprint' | 'done' | 'missed';

interface Workout {
  id: string;
  title: string;
  type: string;
  duration: number; // minutes
  description: string;
  status: WorkoutStatus;
  assignedDay?: string;
  sprintNumber?: number; // tracks which sprint this was assigned to
}

interface SprintHistory {
  sprintNumber: number;
  completedWorkouts: number;
  totalWorkouts: number;
  velocityScore: number;
  insights: string[];
}

const TYPE_COLORS: Record<string, string> = {
  Strength: 'text-rose-700 bg-rose-50 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20',
  Cardio: 'text-sky-700 bg-sky-50 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20',
  Mobility: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
  Recovery: 'text-violet-700 bg-violet-50 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20',
  Endurance: 'text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20',
  HIIT: 'text-orange-700 bg-orange-50 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20',
};

// --- Local Storage Hook ---
function useLocalStorage<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const setValue: React.Dispatch<React.SetStateAction<T>> = (value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  };

  return [storedValue, setValue];
}

// --- Main App Component ---
export default function App() {
  const [currentTab, setCurrentTab] = useLocalStorage<'dashboard' | 'backlog' | 'sprint'>('af_tab', 'dashboard');
  
  // App State
  const [epic, setEpic] = useLocalStorage<string>('af_epic', '');
  const [epicDeadline, setEpicDeadline] = useLocalStorage<string>('af_deadline', '');
  const [age, setAge] = useLocalStorage<string>('af_age', '');
  const [gender, setGender] = useLocalStorage<string>('af_gender', '');
  const [weight, setWeight] = useLocalStorage<string>('af_weight', '');
  const [injuries, setInjuries] = useLocalStorage<string>('af_injuries', '');
  const [isEpicSet, setIsEpicSet] = useLocalStorage<boolean>('af_isEpicSet', false);
  const [workouts, setWorkouts] = useLocalStorage<Workout[]>('af_workouts', []);
  const [history, setHistory] = useLocalStorage<SprintHistory[]>('af_history', []);
  const [currentSprintNum, setCurrentSprintNum] = useLocalStorage<number>('af_sprintNum', 1);
  const [sprintEndDate, setSprintEndDate] = useLocalStorage<string | null>('af_sprintEnd', null);
  
  // Settings State
  const [sprintLength, setSprintLength] = useLocalStorage<number>('af_sprintLength', 7);
  const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('af_theme', 'dark');

  // UI State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Modals
  const [isPlanningModalOpen, setPlanningModalOpen] = useState(false);
  const [isRetroModalOpen, setRetroModalOpen] = useState(false);
  const [isSettingsModalOpen, setSettingsModalOpen] = useState(false);
  const [scheduleText, setScheduleText] = useState('');
  const [retroText, setRetroText] = useState('');

  // Excel Logic
  const handleExportWorkouts = () => {
    const ws = XLSX.utils.json_to_sheet(workouts.map(w => ({
      ID: w.id,
      Title: w.title,
      Type: w.type,
      Duration: w.duration,
      Description: w.description,
      Status: w.status,
      AssignedDay: w.assignedDay || '',
      SprintNumber: w.sprintNumber || ''
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Workouts");
    XLSX.writeFile(wb, "AgileFit_Workouts.xlsx");
  };

  // SPRINT LOGIC
  
  // Derived State
  const backlogCount = workouts.filter(w => w.status === 'backlog').length;
  
  // Only show workouts assigned to the CURRENT sprint
  const activeSprintWorkouts = workouts.filter(w => 
    w.sprintNumber === currentSprintNum && 
    (w.status === 'sprint' || w.status === 'done' || w.status === 'missed')
  );

  const uniqueDays = Array.from(new Set(activeSprintWorkouts.map(w => w.assignedDay).filter(Boolean))) as string[];
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  uniqueDays.sort((a, b) => {
    const aIndex = dayOrder.indexOf(a);
    const bIndex = dayOrder.indexOf(b);
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    
    const aMatch = a.match(/Day (\d+)/);
    const bMatch = b.match(/Day (\d+)/);
    if (aMatch && bMatch) return parseInt(aMatch[1]) - parseInt(bMatch[1]);
    
    return a.localeCompare(b);
  });

  
  const doneCount = workouts.filter(w => w.status === 'done').length;
  const totalCompletion = workouts.length > 0 ? Math.round((doneCount / workouts.length) * 100) : 0;
  
  // Chart Data preparation
  const chartData = useMemo(() => {
    // Generate simulated early history to make the chart look nice initially if history is empty
    const base = history.length > 0 ? history : [
      { sprintNumber: 0, completedWorkouts: 0, velocityScore: 0 },
    ];
    return base.map(h => ({
      name: `Sprint ${h.sprintNumber}`,
      completed: h.completedWorkouts,
      velocity: h.velocityScore,
    }));
  }, [history]);

  // --- AI Actions ---

  const handleCreateEpic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!epic.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const parsedWorkouts = await generateEpicBacklog({ epic, age, gender, weight, injuries, epicDeadline });
      
      const newWorkouts = parsedWorkouts.map((w: any) => ({ ...w, status: 'backlog' as const }));
      setWorkouts(newWorkouts);
      setIsEpicSet(true);
      setCurrentTab('backlog');
    } catch (err: any) {
      if (err?.message?.includes("503") || err?.status === 503 || err?.message?.includes("UNAVAILABLE")) {
        setError("The free-tier AI servers are currently experiencing peak traffic. Please try generating again in a couple of minutes!");
      } else if (err?.message?.includes("400") || err?.status === 400 || err?.message?.includes("API key not valid")) {
        setError("Your API key is invalid or missing. Ensure you updated the GEMINI_API_KEY secret in your GitHub repository settings!");
      } else {
        setError(err.message || "Failed to create Epic backlog. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlanSprint = async () => {
    if (!scheduleText.trim()) return;
    setIsLoading(true);
    setError(null);
    
    // Pass only backlog items to the AI
    const availableBacklog = workouts.filter(w => w.status === 'backlog');
    const backlogContext = availableBacklog.map(w => ({ id: w.id, title: w.title, duration: `${w.duration}m` }));

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + sprintLength);
    const formattedDeadline = targetDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });

    try {
      const selections: { workoutId: string, day: string }[] = await planSprint({ scheduleText, backlogContext, sprintLength, formattedDeadline });
      
      // Update local state
      setWorkouts(prev => prev.map(w => {
        const selection = selections.find(s => s.workoutId === w.id);
        if (selection && w.status === 'backlog') {
          return { ...w, status: 'sprint', assignedDay: selection.day, sprintNumber: currentSprintNum };
        }
        return w;
      }));
      
      setPlanningModalOpen(false);
      setScheduleText('');
      setSprintEndDate(targetDate.toISOString());
      setCurrentTab('sprint');
    } catch (err: any) {
      if (err?.message?.includes("503") || err?.status === 503 || err?.message?.includes("UNAVAILABLE")) {
        setError("The free-tier AI servers are experiencing high traffic. Please try generating again in a few minutes!");
      } else if (err?.message?.includes("400") || err?.status === 400 || err?.message?.includes("API key not valid")) {
        setError("Your API key is invalid or missing. Ensure you updated the GEMINI_API_KEY secret in your GitHub repository settings!");
      } else {
        setError(err.message || "Sprint planning failed. Ensure your backlog has remaining items.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteSprint = async () => {
    if (!retroText.trim()) return;
    setIsLoading(true);
    setError(null);

    const sprintWks = workouts.filter(w => w.sprintNumber === currentSprintNum && (w.status === 'sprint' || w.status === 'done' || w.status === 'missed'));
    const completedCount = sprintWks.filter(w => w.status === 'done').length;
    
    // Auto-mark remaining 'sprint' items as missed for the retro context
    const retroContextWorkouts = sprintWks.map(w => ({
      title: w.title,
      status: w.status === 'sprint' ? 'missed' : w.status
    }));

    try {
      const result = await completeSprintRetro({ retroContextWorkouts, retroText });
      const newBacklogItems = (result.newWorkouts || []).map((w: any) => ({ ...w, status: 'backlog' as const }));
      
      // Update historical data
      const velocity = Math.round((completedCount / sprintWks.length) * 100) || 0;
      setHistory(prev => [...prev, {
        sprintNumber: currentSprintNum,
        completedWorkouts: completedCount,
        totalWorkouts: sprintWks.length,
        velocityScore: velocity,
        insights: result.insights || [],
      }]);

      // Archive uncompleted sprint logic: change currently active 'sprint' items to 'missed' status
      setWorkouts(prev => {
        let updated = prev.map(w => {
          if (w.sprintNumber === currentSprintNum && w.status === 'sprint') {
            return { ...w, status: 'missed' as WorkoutStatus };
          }
          return w;
        });
        return [...updated, ...newBacklogItems];
      });

      setCurrentSprintNum(prev => prev + 1);
      setSprintEndDate(null);
      setRetroModalOpen(false);
      setRetroText('');
      setCurrentTab('sprint');
      
      // Automatically prompt the user to plan the next sprint immediately, simulating a real agile ceremony
      setTimeout(() => setPlanningModalOpen(true), 300);
      
    } catch (err: any) {
      if (err?.message?.includes("503") || err?.status === 503 || err?.message?.includes("UNAVAILABLE")) {
        setError("The free-tier AI servers are experiencing high traffic. Please try submitting your retro again in a few minutes!");
      } else if (err?.message?.includes("400") || err?.status === 400 || err?.message?.includes("API key not valid")) {
        setError("Your API key is invalid or missing. Ensure you updated the GEMINI_API_KEY secret in your GitHub repository settings!");
      } else {
        setError(err.message || "Retrospective generation failed. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const toggleWorkoutStatus = (id: string, current: string) => {
    if (current === 'sprint') {
      setWorkouts(prev => prev.map(w => w.id === id ? { ...w, status: 'done' } : w));
    } else if (current === 'done') {
      setWorkouts(prev => prev.map(w => w.id === id ? { ...w, status: 'sprint' } : w));
    }
  };

  // --- UI Components ---
  if (!isEpicSet) {
    return (
      <div className={theme === 'dark' ? 'dark' : ''}>
        <div className="min-h-screen relative overflow-hidden bg-mesh-light dark:bg-mesh-dark animate-mesh flex flex-col items-center justify-center p-6 selection:bg-indigo-500/20 transition-colors duration-1000">
          
          {/* Decorative Animated Blobs */}
          <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
             <div className="absolute top-1/4 -left-1/4 w-[500px] h-[500px] bg-indigo-500/20 dark:bg-indigo-600/20 rounded-full mix-blend-multiply dark:mix-blend-lighten filter blur-3xl opacity-70 animate-blob"></div>
             <div className="absolute top-1/3 -right-1/4 w-[600px] h-[600px] bg-violet-500/20 dark:bg-fuchsia-600/20 rounded-full mix-blend-multiply dark:mix-blend-lighten filter blur-3xl opacity-70 animate-blob animation-delay-2000"></div>
             <div className="absolute -bottom-32 left-1/3 w-[800px] h-[800px] bg-rose-500/20 dark:bg-cyan-600/20 rounded-full mix-blend-multiply dark:mix-blend-lighten filter blur-3xl opacity-70 animate-blob animation-delay-4000"></div>
          </div>

          <motion.div 
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl w-full glass-panel p-6 md:p-10 rounded-3xl md:rounded-[2rem] relative z-10"
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-violet-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
                  <BrainCircuit className="w-8 h-8" />
                </div>
                <div>
                  <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-400">Agile Fitness</h1>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium tracking-wide uppercase mt-1">AI-Powered Sprint Management</p>
                </div>
              </div>
            </div>
            
            <form onSubmit={handleCreateEpic} className="space-y-6">
              
              {/* Epic Goal */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 ml-1">Define your Epic (Ultimate Goal)</label>
                  <textarea 
                    value={epic}
                    onChange={(e) => setEpic(e.target.value)}
                    placeholder="E.g., Prepare for the Chicago Marathon in 12 weeks..."
                    className="w-full h-24 p-4 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 resize-none transition-all"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 ml-1">Ultimate Deadline Date (Optional)</label>
                  <input 
                    type="date"
                    value={epicDeadline}
                    onChange={(e) => setEpicDeadline(e.target.value)}
                    className="w-full h-11 px-4 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-sm color-scheme-light dark:color-scheme-dark"
                  />
                </div>
              </div>

              {/* Personal Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 ml-1">Age</label>
                  <input 
                    type="number"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="e.g. 30"
                    className="w-full h-11 px-4 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 ml-1">Gender</label>
                  <select 
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full h-11 px-4 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-sm appearance-none"
                  >
                    <option value="">Select...</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Non-binary">Non-binary</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 ml-1">Weight</label>
                  <input 
                    type="text"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder="e.g. 180 lbs or 82 kg"
                    className="w-full h-11 px-4 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-sm"
                  />
                </div>
              </div>

              {/* Injuries */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 ml-1">Injuries & Ongoing Health Conditions</label>
                <textarea 
                  value={injuries}
                  onChange={(e) => setInjuries(e.target.value)}
                  placeholder="E.g., Recovering from ACL surgery on left knee, mild asthma."
                  className="w-full h-16 p-4 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 resize-none transition-all text-sm"
                />
              </div>

              <div className="pt-4 border-t border-slate-200/50 dark:border-white/10 space-y-4">
                 <div className="flex flex-col space-y-2">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Sprint Lifecycle (Days)</label>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Adjust the length of your Agile execution cycles</p>
                 </div>
                 <div className="flex items-center gap-6 bg-slate-50/50 dark:bg-slate-950/30 p-4 rounded-xl border border-slate-200/50 dark:border-white/5">
                    <input type="range" min="3" max="14" value={sprintLength} onChange={(e) => setSprintLength(parseInt(e.target.value))} className="w-full accent-indigo-600 dark:accent-indigo-400 cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none" />
                    <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-br from-indigo-600 to-violet-600 dark:from-indigo-400 dark:to-cyan-400 w-16 text-center">{sprintLength}d</span>
                 </div>
              </div>
              
              <button 
                type="submit"
                disabled={isLoading || !epic.trim()}
                className="w-full h-14 mt-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl font-bold text-lg shadow-xl shadow-indigo-600/25 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed group relative overflow-hidden focus:outline-none focus:ring-4 focus:ring-indigo-500/30"
              >
                <div className="absolute inset-0 w-full h-full bg-white/20 blur group-hover:translate-x-full transition-transform duration-700 -translate-x-full z-0" />
                {isLoading ? (
                  <Orbit className="w-6 h-6 animate-spin text-indigo-100 z-10" />
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 text-indigo-200 group-hover:scale-125 group-hover:text-white transition-all z-10" />
                    <span className="z-10">Compile Epic Backlog</span>
                  </>
                )}
              </button>
              {error && (
                <div className="mt-6 p-4 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-xl flex items-center justify-center gap-2 font-medium border border-rose-200 dark:border-rose-500/20 text-sm break-words whitespace-pre-wrap text-center">
                  <Info className="w-5 h-5 shrink-0" /> {error}
                </div>
              )}
            </form>
          </motion.div>
        </div>
      </div>
    );
  }

  const isSprintActive = activeSprintWorkouts.some(w => w.status === 'sprint' || w.status === 'done');
  const sprintProgress = isSprintActive ? Math.round((activeSprintWorkouts.filter(w=>w.status==='done').length / activeSprintWorkouts.length) * 100) : 0;

  return (
    <div className={theme === 'dark' ? 'dark' : ''}>
      <div className="h-screen w-full flex flex-col md:flex-row bg-mesh-light dark:bg-mesh-dark animate-mesh text-slate-800 dark:text-slate-200 font-sans selection:bg-indigo-500/20 transition-colors duration-1000 relative">
        
        {/* Background Blobs for Main App */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
           <div className="absolute top-1/4 right-0 w-[600px] h-[600px] bg-indigo-500/10 dark:bg-indigo-500/10 rounded-full filter blur-3xl opacity-50 animate-blob"></div>
           <div className="absolute bottom-0 left-64 w-[700px] h-[700px] bg-sky-500/10 dark:bg-cyan-500/10 rounded-full filter blur-3xl opacity-50 animate-blob animation-delay-4000"></div>
        </div>

        {/* Sidebar Navigation */}
        <aside className="hidden md:flex w-68 glass-panel border-r-0 border-r-white/20 dark:border-r-white/5 flex-col shrink-0 transition-colors duration-500 z-20 shadow-2xl">
          <div className="h-24 flex items-center px-8 border-b border-slate-200/50 dark:border-white/5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                <BrainCircuit className="w-5 h-5 text-white" />
              </div>
              <span className="font-extrabold text-xl tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-300">Agile<span className="text-indigo-600 dark:text-indigo-400">Fit</span></span>
            </div>
          </div>

          <nav className="flex-1 px-4 py-6 space-y-1">
            <NavItem 
              icon={<LayoutDashboard className="w-4 h-4" />} 
              label="Dashboard Overview" 
              active={currentTab === 'dashboard'} 
              onClick={() => setCurrentTab('dashboard')} 
            />
            <NavItem 
              icon={<ListTodo className="w-4 h-4" />} 
              label="Product Backlog" 
              active={currentTab === 'backlog'} 
              onClick={() => setCurrentTab('backlog')} 
              badge={backlogCount}
            />
            <NavItem 
              icon={<CalendarDays className="w-4 h-4" />} 
              label="Active Sprint" 
              active={currentTab === 'sprint'} 
              onClick={() => setCurrentTab('sprint')} 
              badge={isSprintActive ? 'LIVE' : null}
              badgeColor="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20"
            />
          </nav>

          <div className="p-4 m-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-white/5">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Current Context</div>
            <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 font-medium mb-1">
              <Target className="w-4 h-4 text-indigo-500" />
              Sprint {currentSprintNum} ({sprintLength} Days)
            </div>
            {isSprintActive && sprintEndDate && (
              <div className="flex items-center gap-2 text-xs text-rose-500 dark:text-rose-400 font-medium mb-1 mt-2">
                <Clock className="w-3.5 h-3.5" />
                Sprint Deadline: {new Date(sprintEndDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </div>
            )}
            {epicDeadline && (
              <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 font-bold mb-1 mt-2">
                <Trophy className="w-3.5 h-3.5" />
                Epic Target: {new Date(epicDeadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            )}
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 mt-3 overflow-hidden">
              <div className="bg-indigo-600 dark:bg-indigo-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${totalCompletion}%` }}></div>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 font-medium text-right">{totalCompletion}% Epic Progress</p>
          </div>

          <div className="p-4 border-t border-slate-200 dark:border-white/10 flex justify-center gap-4">
             <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors">
               {theme === 'dark' ? <Sun className="w-4 h-4 text-slate-300" /> : <Moon className="w-4 h-4 text-slate-600" />}
             </button>
             <button onClick={() => setSettingsModalOpen(true)} className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors">
               <Settings className="w-4 h-4 text-slate-600 dark:text-slate-300" />
             </button>
          </div>
        </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full glass-panel border-t border-t-white/20 dark:border-t-white/5 z-50 flex items-center justify-around px-2 py-2 pb-safe shadow-[0_-10px_20px_rgba(0,0,0,0.1)]">
        <button onClick={() => setCurrentTab('dashboard')} className={cn("p-2 rounded-xl flex flex-col items-center gap-1 transition-all", currentTab === 'dashboard' ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-500/10" : "text-slate-500 dark:text-slate-400 hover:text-slate-900")}>
          <LayoutDashboard className="w-5 h-5" />
          <span className="text-[10px] font-bold">Dashboard</span>
        </button>
        <button onClick={() => setCurrentTab('backlog')} className={cn("p-2 rounded-xl flex flex-col items-center gap-1 transition-all relative", currentTab === 'backlog' ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-500/10" : "text-slate-500 dark:text-slate-400 hover:text-slate-900")}>
          <ListTodo className="w-5 h-5" />
          <span className="text-[10px] font-bold">Backlog</span>
          {backlogCount > 0 && <span className="absolute top-1 right-2 w-2 h-2 bg-indigo-500 rounded-full"></span>}
        </button>
        <button onClick={() => setCurrentTab('sprint')} className={cn("p-2 rounded-xl flex flex-col items-center gap-1 transition-all relative", currentTab === 'sprint' ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-500/10" : "text-slate-500 dark:text-slate-400 hover:text-slate-900")}>
          <CalendarDays className="w-5 h-5" />
          <span className="text-[10px] font-bold">Sprint</span>
          {isSprintActive && <span className="absolute top-1 right-2 w-2 h-2 bg-emerald-500 rounded-full"></span>}
        </button>
        <div className="w-[1px] h-8 bg-slate-200 dark:bg-white/10 mx-1"></div>
        <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} className="p-3 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400">
           {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
        <button onClick={() => setSettingsModalOpen(true)} className="p-3 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400">
          <Settings className="w-5 h-5" />
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10 p-2 pb-24 md:p-6 md:pb-6">
        <div className="glass-panel flex-1 rounded-3xl md:rounded-[2.5rem] flex flex-col overflow-hidden relative shadow-2xl border-white/40 dark:border-white/10">
          <header className="h-24 bg-white/40 dark:bg-slate-950/40 backdrop-blur-sm border-b border-slate-200/50 dark:border-white/5 flex flex-col md:flex-row items-center justify-between px-6 md:px-10 shrink-0 z-10 sticky top-0 transition-colors duration-500 py-3 md:py-0 gap-3 md:gap-0">
            <div className="w-full text-center md:text-left flex flex-col items-center md:items-start whitespace-nowrap overflow-hidden">
              <h2 className="text-xl md:text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 capitalize truncate w-full">
                {currentTab.replace('-', ' ')}
              </h2>
              <p className="hidden md:block text-sm text-slate-600 dark:text-slate-400 font-medium truncate max-w-lg mt-1 tracking-wide" title={epic}>
                <span className="opacity-70">Epic:</span> {epic}
              </p>
            </div>
            
            <div className="flex items-center gap-2 md:gap-4 shrink-0">
              {isSprintActive ? (
                <button 
                  onClick={() => setRetroModalOpen(true)}
                  className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-500/25 transition-all flex items-center gap-2 border border-emerald-400/50 focus:ring-4 focus:ring-emerald-500/30"
                >
                  <CheckCircle2 className="w-4 h-4" /> Finalize Sprint Iteration
                </button>
              ) : (
                <button 
                  onClick={() => setPlanningModalOpen(true)}
                  className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-600/25 transition-all flex items-center gap-2 border border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/30"
                >
                  <Play className="w-4 h-4 fill-current" /> Plan Next Iteration
                </button>
              )}
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-4 md:p-10 bg-gradient-to-b from-transparent to-slate-50/50 dark:to-slate-950/20">
            <div className="max-w-6xl mx-auto h-full">

            {/* TAB: DASHBOARD */}
            {currentTab === 'dashboard' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Top Metrics Row */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <MetricCard title="Sprint Velocity" value={history.length > 0 ? `${history[history.length-1].velocityScore}%` : 'N/A'} subtitle="Last Sprint Completion" icon={<Zap className="w-5 h-5 text-amber-500" />} />
                  <MetricCard title="Workouts Done" value={doneCount} subtitle="All Time" icon={<Dumbbell className="w-5 h-5 text-indigo-500" />} />
                  <MetricCard title="Backlog Depth" value={backlogCount} subtitle="Pending Workouts" icon={<ListTodo className="w-5 h-5 text-slate-500" />} />
                  <MetricCard title="Epic Progress" value={`${totalCompletion}%`} subtitle="Completion Bar" icon={<Trophy className="w-5 h-5 text-emerald-500" />} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Chart Section */}
                  <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <h3 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2">
                       <Activity className="w-4 h-4 text-indigo-600" /> Velocity Trend
                    </h3>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorVelocity" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                          <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                          <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                          <Area type="monotone" dataKey="velocity" stroke="#4f46e5" strokeWidth={3} fillOpacity={1} fill="url(#colorVelocity)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* AI Insights & History */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                    <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
                      <BrainCircuit className="w-4 h-4 text-indigo-600" /> AI Retrospectives
                    </h3>
                    <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                      {history.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm text-center px-4">
                          Complete your first sprint to generate AI coaching insights.
                        </div>
                      ) : (
                        history.slice().reverse().map((h, i) => (
                          <div key={i} className="pb-4 border-b border-slate-100 last:border-0">
                            <div className="text-xs font-bold text-indigo-600 mb-2 uppercase tracking-wider">Sprint {h.sprintNumber}</div>
                            <ul className="space-y-2">
                              {h.insights.map((insight, j) => (
                                <li key={j} className="text-sm text-slate-600 flex items-start gap-2 leading-relaxed">
                                  <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0" />
                                  {insight}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: BACKLOG */}
            {currentTab === 'backlog' && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
                  <h3 className="font-bold text-slate-900">Product Backlog ({backlogCount} Items)</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {workouts.filter(w => w.status === 'backlog').length === 0 ? (
                     <div className="p-12 text-center text-slate-500 flex flex-col items-center">
                        <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-4" />
                        <p className="text-lg font-medium text-slate-800">Backlog is Empty!</p>
                        <p>You have scheduled or completed all generated workouts.</p>
                     </div>
                  ) : (
                    workouts.filter(w => w.status === 'backlog').map(workout => (
                      <div key={workout.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between group">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex flex-col items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-slate-600">{workout.duration}</span>
                            <span className="text-[9px] text-slate-400 font-medium uppercase">min</span>
                          </div>
                          <div>
                            <h4 className="font-semibold text-slate-800 flex items-center gap-2">
                              {workout.title}
                              <TypeBadge type={workout.type} />
                            </h4>
                            <p className="text-sm text-slate-500 mt-1 max-w-3xl leading-relaxed">{workout.description}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB: SPRINT */}
            {currentTab === 'sprint' && (
              <div className="h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                {!isSprintActive ? (
                  <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
                    <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center border border-indigo-100 mb-6">
                      <CalendarDays className="w-8 h-8 text-indigo-500" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">No Active Sprint</h2>
                    <p className="text-slate-500 mb-8 leading-relaxed">
                      Your current Sprint board is empty. Provide your schedule to the AI Scrum Master to pull the right workouts from your backlog.
                    </p>
                    <button 
                      onClick={() => setPlanningModalOpen(true)}
                      className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-md shadow-indigo-600/20 transition-all flex items-center gap-2"
                    >
                      Plan Sprint {currentSprintNum}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6">
                     <div className="flex items-center justify-between bg-white px-6 py-4 rounded-2xl border border-slate-200 shadow-sm">
                       <div>
                         <h3 className="text-lg font-bold text-slate-900">Sprint {currentSprintNum} Execution</h3>
                         <div className="flex items-center gap-3 mt-1">
                           <p className="text-sm text-slate-500">{activeSprintWorkouts.filter(w=>w.status==='done').length} of {activeSprintWorkouts.length} workouts completed</p>
                           {sprintEndDate && (
                             <span className="text-xs font-semibold bg-rose-100/80 text-rose-600 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
                               <Clock className="w-3 h-3" />
                               Due {new Date(sprintEndDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                             </span>
                           )}
                         </div>
                       </div>
                       <div className="w-64">
                         <div className="flex justify-between text-xs font-semibold mb-2">
                           <span className="text-indigo-600">Progress</span>
                           <span className="text-slate-600">{sprintProgress}%</span>
                         </div>
                         <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden shadow-inner">
                           <div className="bg-indigo-600 h-2 rounded-full transition-all duration-500 relative overflow-hidden" style={{ width: `${sprintProgress}%` }}>
                              <div className="absolute top-0 bottom-0 left-0 right-0 bg-white/20 animate-[shimmer_2s_infinite] translate-x-[-100%] skew-x-[-20deg]" />
                           </div>
                         </div>
                       </div>
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 align-items-start">
                        {uniqueDays.map(day => (
                          <motion.div layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} key={day} className="bg-white/80 dark:bg-slate-900/80 backdrop-blur rounded-2xl border border-white/40 dark:border-white/10 shadow-sm overflow-hidden flex flex-col relative group transition-colors">
                             <div className="px-5 py-3 border-b border-black/5 dark:border-white/5 bg-slate-50/50 dark:bg-slate-800/50 flex justify-between items-center">
                               <h4 className="font-bold text-slate-800 dark:text-slate-200">{day}</h4>
                             </div>
                             <div className="p-4 space-y-3">
                               {activeSprintWorkouts.filter(w => w.assignedDay === day).map(workout => (
                                 <motion.div 
                                  layout
                                  key={workout.id} 
                                  className={cn(
                                    "p-4 rounded-xl border relative transition-all group/card",
                                    workout.status === 'done' 
                                      ? "bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-white/5 opacity-60" 
                                      : "bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 hover:border-indigo-300 dark:hover:border-indigo-500 shadow-sm hover:shadow-md cursor-pointer"
                                  )}
                                  onClick={() => toggleWorkoutStatus(workout.id, workout.status)}
                                 >
                                    <div className="flex justify-between items-start mb-2">
                                      <TypeBadge type={workout.type} />
                                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                                        <Clock className="w-3 h-3" />
                                        {workout.duration}m
                                      </div>
                                    </div>
                                    <h5 className={cn(
                                      "font-semibold leading-snug mb-1.5 text-sm",
                                      workout.status === 'done' ? "text-slate-500 dark:text-slate-500 line-through" : "text-slate-800 dark:text-slate-200"
                                    )}>
                                      {workout.title}
                                    </h5>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                      {workout.description}
                                    </p>

                                    {/* Done Check Overlay */}
                                    <div className={cn(
                                      "absolute -right-2 -top-2 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm opacity-0 transition-all border-2 border-white dark:border-slate-800 transform scale-75",
                                      workout.status === 'done' ? "opacity-100 scale-100" : "group-hover/card:opacity-30 group-hover/card:scale-100"
                                    )}>
                                      <Check className="w-3.5 h-3.5" />
                                    </div>
                                 </motion.div>
                               ))}
                             </div>
                          </motion.div>
                        ))}
                     </div>
                  </div>
                )}
              </div>
            )}

            </div>
          </div>
        </div>
      </main>

      {/* --- MODALS --- */}
      
      {/* Sprint Planning Modal */}
      {isPlanningModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <Play className="w-4 h-4 text-indigo-600 fill-current" /> Plan Sprint {currentSprintNum}
              </h3>
              <button disabled={isLoading} onClick={() => setPlanningModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6">
              <p className="text-sm font-medium text-slate-600 mb-4 flex items-start gap-2">
                <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                Provide your availability or constraints for this week. The AI Scrum Master will pull 3-5 workouts from your backlog to fit.
              </p>
              <textarea 
                value={scheduleText}
                onChange={(e) => setScheduleText(e.target.value)}
                placeholder="E.g., Busy Tuesday and Thursday with late meetings. Free weekends. Need a rest day on Wednesday."
                className="w-full h-32 p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-sm mb-6"
              />
              <button 
                onClick={handlePlanSprint}
                disabled={isLoading || !scheduleText.trim()}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-md flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {isLoading ? <Orbit className="w-5 h-5 animate-spin" /> : 'Generate Sprint Plan'}
              </button>
              {error && <p className="text-red-500 text-xs text-center font-medium mt-3">{error}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Retrospective Modal */}
      {isRetroModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-rose-50/50">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-rose-600" /> Sprint {currentSprintNum} Retrospective
              </h3>
              <button disabled={isLoading} onClick={() => setRetroModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-lg font-bold text-slate-700">
                  {sprintProgress}%
                </div>
                <div>
                  <h4 className="font-semibold text-slate-800">Completion Score</h4>
                  <p className="text-xs text-slate-500">Provide feedback to adjust next week's backlog.</p>
                </div>
              </div>
              
              <textarea 
                value={retroText}
                onChange={(e) => setRetroText(e.target.value)}
                placeholder="E.g., Knees felt a bit sore after the speedwork. The long run on Sunday was great though!"
                className="w-full h-32 p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all text-sm mb-6"
              />
              <button 
                onClick={handleCompleteSprint}
                disabled={isLoading || !retroText.trim()}
                className="w-full h-11 bg-slate-900 hover:bg-black text-white rounded-xl font-semibold shadow-md flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {isLoading ? <Orbit className="w-5 h-5 animate-spin" /> : 'End Sprint & Update Backlog'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <AnimatePresence>
      {isSettingsModalOpen && (
        <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <motion.div initial={{scale: 0.95, y: 10}} animate={{scale: 1, y: 0}} exit={{scale: 0.95, y: 10}} className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-white/10 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
              <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-slate-600 dark:text-slate-400" /> Preferences
              </h3>
              <button onClick={() => setSettingsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-6">
              
              <div className="space-y-3">
                 <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Sprint Length Base</label>
                 <div className="flex items-center gap-3">
                    <input type="range" min="3" max="14" value={sprintLength} onChange={(e) => setSprintLength(parseInt(e.target.value))} className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer" />
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200 w-12 text-center bg-slate-100 dark:bg-slate-800 rounded-lg py-1">{sprintLength}d</span>
                 </div>
                 <p className="text-[10px] text-slate-500 dark:text-slate-400">Changing this affects the number of days you plan for in future sprints.</p>
              </div>



              <div className="space-y-3">
                 <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Theme Preference</label>
                 <div className="flex border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden p-1 bg-slate-50 dark:bg-slate-800/50">
                   <button onClick={() => setTheme('light')} className={cn("flex-1 py-1.5 text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-all", theme === 'light' ? "bg-white text-slate-900 shadow-sm border border-slate-200" : "text-slate-500 hover:text-slate-700")}>
                     <Sun className="w-4 h-4" /> Light
                   </button>
                   <button onClick={() => setTheme('dark')} className={cn("flex-1 py-1.5 text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-all", theme === 'dark' ? "bg-slate-700 text-white shadow-sm border border-slate-600" : "text-slate-400 hover:text-slate-200")}>
                     <Moon className="w-4 h-4" /> Dark
                   </button>
                 </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-white/10">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Data Management</label>
                <div className="flex gap-2">
                  <button 
                    onClick={handleExportWorkouts}
                    className="w-full py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-sm transition-colors flex items-center justify-center gap-2 border border-slate-200 dark:border-white/5"
                  >
                    <Download className="w-4 h-4" /> Export Backlog to Excel
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-white/10">
                <button 
                  onClick={() => {
                    if (window.confirm("Are you sure you want to reset your entire Epic and Sprint progress? This cannot be undone.")) {
                      window.localStorage.clear();
                      window.location.reload();
                    }
                  }}
                  className="w-full py-2.5 rounded-xl border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 font-semibold text-sm hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                >
                  Reset Entire Epic
                </button>
              </div>

            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Global CSS enhancements */}
      <style>{`
        @keyframes shimmer {
          100% { transform: translateX(100%) skewX(-20deg); }
        }
      `}</style>
      </div>
    </div>
  );
}

// --- Subcomponents ---

function NavItem({ icon, label, active, onClick, badge, badgeColor }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, badge?: React.ReactNode, badgeColor?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all text-sm font-semibold",
        active ? "bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400" : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200"
      )}
    >
      <div className="flex items-center gap-3">
        {icon}
        {label}
      </div>
      {badge !== undefined && badge !== null && (
        <span className={cn(
          "px-2 py-0.5 rounded text-[10px] font-bold border",
          badgeColor || (active ? "bg-indigo-100 dark:bg-indigo-500/20 border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-400" : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400")
        )}>{badge}</span>
      )}
    </button>
  );
}

function MetricCard({ title, value, subtitle, icon }: { title: string, value: React.ReactNode, subtitle: string, icon: React.ReactNode }) {
  return (
    <motion.div initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl p-5 rounded-2xl border border-white/20 dark:border-white/10 shadow-sm flex flex-col transition-colors">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-slate-500 dark:text-slate-400">{title}</h4>
        <div className="p-2 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-100 dark:border-white/5">{icon}</div>
      </div>
      <div className="text-3xl font-bold text-slate-900 dark:text-white mb-1">{value}</div>
      <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">{subtitle}</div>
    </motion.div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const colorClass = TYPE_COLORS[type] || 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-white/10';
  return (
    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border", colorClass)}>
      {type}
    </span>
  );
}


