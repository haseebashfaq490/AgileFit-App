import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Initialize Gemini API with process.env.GEMINI_API_KEY
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // API Route: Generate Epic Backlog
  app.post("/api/generate-epic", async (req, res) => {
    try {
      const { epic, age, gender, weight, injuries, epicDeadline } = req.body;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are an elite Agile fitness coach.
          User Profile:
          - Age: ${age || 'Not specified'}
          - Gender: ${gender || 'Not specified'}
          - Weight: ${weight || 'Not specified'}
          - Injuries & Health Conditions: ${injuries || 'None'}
          
          The user's Epic Goal is: ${epic}. 
          ${epicDeadline ? `The strict ultimate deadline for this Epic is: ${epicDeadline}.` : ''}
          Generate a comprehensive "Product Backlog" of workouts needed to achieve this over multiple weekly sprints. ${epicDeadline ? 'Scale the number of workouts linearly based on the deadline timeframe.' : 'Provide exactly 15 varied workouts.'}
          Provide structured JSON with realistic durations (minutes) that are safe and appropriate for their profile.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: "A unique 6-char alphanumeric ID" },
                title: { type: Type.STRING },
                type: { type: Type.STRING, description: "E.g., Strength, Cardio, Mobility, HIIT" },
                duration: { type: Type.INTEGER },
                description: { type: Type.STRING }
              },
              required: ["id", "title", "type", "duration", "description"]
            }
          }
        }
      });
      
      const text = response.text;
      res.json(JSON.parse(text || "[]"));
    } catch (error: any) {
      console.error("Epic Generation Error:", error);
      res.status(500).json({ error: error.message || "Failed to generate epic." });
    }
  });

  // API Route: Plan Sprint
  app.post("/api/plan-sprint", async (req, res) => {
    try {
      const { scheduleText, backlogContext, sprintLength, formattedDeadline } = req.body;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are pulling workouts from an Agile Backlog into the Active Sprint.
          The user's schedule constraints for the timeframe starting today and ending on the strict deadline of ${formattedDeadline} (${sprintLength} Days timeframe) are: "${scheduleText}".
          Available Backlog Items: ${JSON.stringify(backlogContext)}.
          
          Select the right amount of workouts from the backlog that best fit this schedule.
          
          CRITICAL INSTRUCTIONS:
          1. EXACT AVAILABILITY: If the user says they are busy or unavailable on a specific day (like "Busy on Friday"), DO NOT schedule any workouts on that exact day.
          2. CONSISTENT FORMATTING: Never mix day formats! If the user mentions days of the week (e.g., "Friday", "weekends"), you MUST output ALL days as explicit days of the week (e.g., "Monday", "Tuesday", "Wednesday"). If they do not mention days of the week, use ONLY generic days (e.g., "Day 1", "Day 2"). Do NOT output a mix of "Friday" and "Day 1".
          
          Return valid JSON mapping workout IDs to days. Do not invent new IDs.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                workoutId: { type: Type.STRING },
                day: { type: Type.STRING, description: "Day to schedule this workout" }
              },
              required: ["workoutId", "day"]
            }
          }
        }
      });
      
      const text = response.text;
      res.json(JSON.parse(text || "[]"));
    } catch (error: any) {
      console.error("Sprint Planning Error:", error);
      res.status(500).json({ error: error.message || "Failed to plan sprint." });
    }
  });

  // API Route: Complete Sprint (Retro)
  app.post("/api/complete-sprint", async (req, res) => {
    try {
      const { retroContextWorkouts, retroText } = req.body;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are an Agile Fitness Scrum Master running a Sprint Retrospective.
          Sprint Results: ${JSON.stringify(retroContextWorkouts)}.
          User Feedback: "${retroText}".
          
          Provide exactly TWO sharp, analytical insights based on their feedback and completion rate.
          Also, generate TWO NEW adjusted workouts to push to their Product Backlog based on this learning 
          (e.g., if they were tired, add a recovery session; if it was easy, add a harder session).`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              insights: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Two analytical insights based on results and feedback."
              },
              newWorkouts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    type: { type: Type.STRING, description: "e.g., Strength, Cardio, Recovery" },
                    duration: { type: Type.INTEGER }
                  },
                  required: ["title", "type", "duration"]
                },
                description: "Two new workouts for the backlog based on retro learning."
              }
            },
            required: ["insights", "newWorkouts"]
          }
        }
      });

      const text = response.text;
      res.json(JSON.parse(text || "{}"));
    } catch (error: any) {
      console.error("Sprint Retro Error:", error);
      res.status(500).json({ error: error.message || "Failed to complete sprint." });
    }
  });


  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
