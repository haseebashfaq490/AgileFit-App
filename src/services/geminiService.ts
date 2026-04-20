import { GoogleGenAI, Type } from "@google/genai";

// Initialize Gemini API
// It will pick up process.env.GEMINI_API_KEY thanks to Vite's define plugin OR you can hardcode here temporarily
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const generateEpicBacklog = async (userData: any) => {
  const { epic, age, gender, weight, injuries, epicDeadline } = userData;
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
  
  return JSON.parse(response.text || "[]");
};

export const planSprint = async (sprintData: any) => {
  const { scheduleText, backlogContext, sprintLength, formattedDeadline } = sprintData;
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
  
  return JSON.parse(response.text || "[]");
};

export const completeSprintRetro = async (retroData: any) => {
  const { retroContextWorkouts, retroText } = retroData;
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

  return JSON.parse(response.text || "{}");
};
