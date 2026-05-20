import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { GoogleGenAI, Session, LiveServerMessage, Modality, MediaResolution, Type } from '@google/genai';
import { DEFAULT_BOX_TYPES, type BoxType } from '@/lib/defaultBoxTypes';

interface InventoryItem {
  id: string;
  name: string;
  itemType: 'furniture' | 'packed_box' | 'boxes_needed';
  quantity: number;
  cuft: number;
  weight: number;
  room?: string;
  special_handling?: string;
  box_type?: string;
  for_items?: string;
  label?: string;
  timestamp: Date;
}

interface GeminiLiveState {
  isConnected: boolean;
  isStreaming: boolean;
  inventory: InventoryItem[];
  sessionDuration: number;
  reconnectCount: number;
  error: string | null;
}

export function useGeminiLiveInventory(projectId: string, recordingSessionId?: string) {
  const [state, setState] = useState<GeminiLiveState>({
    isConnected: false,
    isStreaming: false,
    inventory: [],
    sessionDuration: 0,
    reconnectCount: 0,
    error: null,
  });

  const sessionRef = useRef<Session | null>(null);
  const aiRef = useRef<GoogleGenAI | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamingRef = useRef(false);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const inventoryRef = useRef<InventoryItem[]>([]);
  const waitingForResponseRef = useRef(false);
  const latestFrameRef = useRef<string | null>(null);
  const recordingSessionIdRef = useRef<string | undefined>(recordingSessionId);

  // Org's box-recommendation config. Fetched on mount so the live AI uses the
  // org's custom box types (names, capacities) and respects the
  // "boxRecommendationsEnabled" master switch. Defaults match the canonical
  // baseline so video-call inventory still works for personal accounts and
  // for orgs that haven't visited /settings/box-types yet.
  const [orgBoxTypes, setOrgBoxTypes] = useState<BoxType[]>(DEFAULT_BOX_TYPES);
  const [boxRecsEnabled, setBoxRecsEnabled] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [recsRes, typesRes] = await Promise.all([
          fetch('/api/settings/box-recommendations'),
          fetch('/api/settings/box-types')
        ]);
        if (cancelled) return;
        if (recsRes.ok) {
          const recsData = await recsRes.json();
          if (recsData && recsData.boxRecommendationsEnabled === false) {
            setBoxRecsEnabled(false);
          } else {
            setBoxRecsEnabled(true);
          }
        }
        if (typesRes.ok) {
          const typesData = await typesRes.json();
          if (Array.isArray(typesData?.boxTypes) && typesData.boxTypes.length > 0) {
            setOrgBoxTypes(typesData.boxTypes);
          }
        }
      } catch (err) {
        // Personal accounts return 403 on these endpoints; defaults already
        // applied, so nothing to do.
        if (!cancelled) {
          console.log('Gemini Live: Using default box-types (could not load org config):', err);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Keep recordingSessionId ref in sync
  useEffect(() => {
    recordingSessionIdRef.current = recordingSessionId;
  }, [recordingSessionId]);

  // Function to save items to database via API
  const saveItemsToDatabase = useCallback(async (items: InventoryItem[]) => {
    if (!projectId || !recordingSessionIdRef.current || items.length === 0) {
      console.log('Gemini Live: Skipping database save - missing projectId or recordingSessionId');
      return;
    }

    try {
      console.log(`Gemini Live: Saving ${items.length} items to database...`);
      const response = await fetch(`/api/projects/${projectId}/inventory/add-live-items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recordingSessionId: recordingSessionIdRef.current,
          items: items.map(item => ({
            name: item.name,
            itemType: item.itemType,
            quantity: item.quantity,
            cuft: item.cuft,
            weight: item.weight,
            room: item.room,
            special_handling: item.special_handling,
            box_type: item.box_type,
            for_items: item.for_items,
            label: item.label,
          })),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Gemini Live: Failed to save items to database:', error);
      } else {
        const result = await response.json();
        console.log(`Gemini Live: Successfully saved ${result.itemsCreated} items to database`);
      }
    } catch (error) {
      console.error('Gemini Live: Error saving items to database:', error);
    }
  }, [projectId]);

  // Keep inventory ref in sync
  useEffect(() => {
    inventoryRef.current = state.inventory;
  }, [state.inventory]);

  // System instruction for inventory detection - aligned with
  // railway-video-service. The BOXES NEEDED section is rebuilt from the
  // org's box-types config (custom names + capacities) or replaced with a
  // disabled stub when the org has turned box recommendations off.
  const boxesNeededSection = useMemo(() => {
    if (!boxRecsEnabled) {
      return `BOXES NEEDED: DISABLED for this organization. Do NOT propose any boxes_needed entries — the boxes_needed array must remain empty. Continue capturing furniture_items and packed_boxes normally.`;
    }
    const lines = orgBoxTypes
      .map((b) => {
        const cap = b.capacityCuft % 1 === 0 ? b.capacityCuft.toFixed(1) : String(b.capacityCuft);
        const desc = b.description ? ` (${b.description})` : '';
        return `  * "${b.name}": ${cap} cuft${desc}`;
      })
      .join('\n');
    return `BOXES NEEDED for loose/unpacked items:
- If you see kitchen cabinets, bathroom cabinets, closets - assume they are full of items needing packing
- Available box types with EXACT capacities:
${lines}
- Never exceed 50 lbs per box - use smaller boxes for heavy items`;
  }, [orgBoxTypes, boxRecsEnabled]);

  const systemInstruction = useMemo(() => `You are an expert moving consultant analyzing images for moving inventory. If items are partially visible, make your best guess of what is there.

CRITICAL QUANTITY COUNTING RULES:
- When you see MULTIPLE IDENTICAL items (e.g., 5 office chairs, 3 nightstands), return ONE entry with the actual quantity in the "quantity" field
- DO NOT create separate entries for each identical item - consolidate them into one entry with the correct count
- cuft and weight should be PER-ITEM values (the system will multiply by quantity for totals)
- Example: If you see 3 dining chairs, return: { "name": "Dining Chair", "quantity": 3, "cuft": 8, "weight": 20 }

FURNITURE ITEMS (don't need boxes):
- Large items: sofas, tables, beds, dressers, desks, chairs, appliances, rugs, lamps, or anything else too large to go in a box
- Include: name, cubic feet, estimated weight, any special handling
- DON'T include: stoves, dishwashers, kitchen sinks, or things built into the home
- CAN include: fridge, washer, dryer, microwave

PACKED BOXES (containers visible in the image):
- Look for ANY containers: cardboard boxes, plastic storage bins, Rubbermaid containers
- Include containers that are taped shut, partially open, or fully open
- Estimate size: Small/Medium/Large/Extra Large based on apparent dimensions

${boxesNeededSection}

Be specific and detailed in item names (e.g., '4-Drawer Dresser' not just 'Dresser', 'L-Shaped Sectional Sofa' not just 'Sofa').`, [boxesNeededSection]);

  // Function declaration for inventory recording.
  // The box_type enum is built from the org's saved box types so custom
  // entries are first-class. When the org has switched box recommendations
  // off, the boxes_needed property is omitted entirely — the AI literally
  // cannot return any.
  const inventoryFunctionDeclaration = useMemo(() => {
    const properties: any = {
      action: { type: Type.STRING, enum: ["add", "update", "remove"], description: "Action to take on inventory" },
      room: { type: Type.STRING, description: "Room where items are seen (Living Room, Kitchen, Bedroom, etc.)" },
      furniture_items: {
        type: Type.ARRAY,
        description: "Large items that don't need boxes",
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "Specific item name (e.g., '4-Drawer Dresser', 'L-Shaped Sectional Sofa')" },
            quantity: { type: Type.NUMBER, description: "Number of identical items" },
            cuft: { type: Type.NUMBER, description: "Cubic feet per item" },
            weight: { type: Type.NUMBER, description: "Estimated weight in lbs per item" },
            special_handling: { type: Type.STRING, description: "Any special requirements" }
          },
          required: ["name", "quantity", "cuft", "weight"]
        }
      },
      packed_boxes: {
        type: Type.ARRAY,
        description: "Boxes or containers already present in the space",
        items: {
          type: Type.OBJECT,
          properties: {
            size: { type: Type.STRING, enum: ["Small", "Medium", "Large", "Extra Large"], description: "Box size" },
            label: { type: Type.STRING, description: "Visible label or contents description" },
            quantity: { type: Type.NUMBER, description: "Number of similar boxes" }
          },
          required: ["size", "quantity"]
        }
      }
    };

    if (boxRecsEnabled && orgBoxTypes.length > 0) {
      properties.boxes_needed = {
        type: Type.ARRAY,
        description: "Boxes needed for loose items that require packing",
        items: {
          type: Type.OBJECT,
          properties: {
            box_type: {
              type: Type.STRING,
              enum: orgBoxTypes.map((b) => b.name),
              description: "Type of box needed — must be one of the listed options"
            },
            quantity: { type: Type.NUMBER, description: "Number of boxes needed" },
            capacity_cuft: { type: Type.NUMBER, description: "Exact capacity in cuft for the chosen box_type (see system instructions for the per-type values)" },
            for_items: { type: Type.STRING, description: "What items these boxes are for" }
          },
          required: ["box_type", "quantity", "capacity_cuft", "for_items"]
        }
      };
    }

    return {
      name: "record_inventory",
      description: "Record inventory items detected in the video. Call this whenever you see furniture, boxes, or items that need packing.",
      parameters: {
        type: Type.OBJECT,
        properties,
        required: ["action", "room"]
      }
    };
  }, [orgBoxTypes, boxRecsEnabled]);

  // Handle inventory update from function call
  const handleInventoryUpdate = useCallback((args: any) => {
    const { action, room, furniture_items, packed_boxes, boxes_needed } = args;

    console.log('handleInventoryUpdate called with:', JSON.stringify({ action, room, furniture_items, packed_boxes, boxes_needed }, null, 2));

    setState(s => {
      let newInventory = [...s.inventory];
      const itemsToAdd: InventoryItem[] = [];

      // Helper to check for duplicates
      const isDuplicate = (name: string, itemType: string) => {
        return newInventory.some(
          existing => existing.name.toLowerCase() === name.toLowerCase() && existing.itemType === itemType
        );
      };

      if (action === 'add') {
        // Process furniture items
        if (furniture_items && Array.isArray(furniture_items)) {
          for (const item of furniture_items) {
            if (item.name && !isDuplicate(item.name, 'furniture')) {
              itemsToAdd.push({
                id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
                name: item.name,
                itemType: 'furniture',
                quantity: item.quantity || 1,
                cuft: item.cuft || 10,
                weight: item.weight || 50,
                room: room,
                special_handling: item.special_handling,
                timestamp: new Date()
              });
            }
          }
        }

        // Process packed boxes
        if (packed_boxes && Array.isArray(packed_boxes)) {
          for (const box of packed_boxes) {
            const boxSize = box.size || box.box_size || 'Medium';
            const boxName = `${boxSize} Box${box.label ? ` - ${box.label}` : ''}`;
            const sizeCuft: Record<string, number> = { 'Small': 1.5, 'Medium': 3.0, 'Large': 4.5, 'Extra Large': 6.0 };

            if (!isDuplicate(boxName, 'packed_box')) {
              itemsToAdd.push({
                id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
                name: boxName,
                itemType: 'packed_box',
                quantity: box.quantity || 1,
                cuft: sizeCuft[boxSize] || box.cuft || 3.0,
                weight: box.weight || 30,
                room: room || 'Unknown',
                label: box.label,
                timestamp: new Date()
              });
            }
          }
        }

        // Process boxes needed
        if (boxes_needed && Array.isArray(boxes_needed)) {
          for (const boxRec of boxes_needed) {
            const boxType = boxRec.box_type || boxRec.boxType || boxRec.type || 'Medium Box';
            const boxName = `${boxType}${boxRec.for_items ? ` (${boxRec.for_items})` : ''}`;

            if (!isDuplicate(boxName, 'boxes_needed')) {
              itemsToAdd.push({
                id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
                name: boxName,
                itemType: 'boxes_needed',
                quantity: boxRec.quantity || 1,
                cuft: boxRec.capacity_cuft || boxRec.cuft || 3.0,
                weight: boxRec.weight || 20,
                room: room || 'Unknown',
                box_type: boxType,
                for_items: boxRec.for_items,
                timestamp: new Date()
              });
            }
          }
        }

        if (itemsToAdd.length > 0) {
          newInventory = [...newInventory, ...itemsToAdd];
          console.log(`Added ${itemsToAdd.length} new items:`, itemsToAdd.map(i => `${i.name} (${i.itemType})`));

          // Save items to database (fire-and-forget)
          saveItemsToDatabase(itemsToAdd);
        }
      } else if (action === 'update') {
        // Update existing items
        if (furniture_items && Array.isArray(furniture_items)) {
          for (const item of furniture_items) {
            newInventory = newInventory.map(existing => {
              if (existing.name.toLowerCase() === item.name?.toLowerCase() && existing.itemType === 'furniture') {
                return {
                  ...existing,
                  quantity: item.quantity || existing.quantity,
                  cuft: item.cuft || existing.cuft,
                  weight: item.weight || existing.weight,
                  room: room || existing.room,
                  special_handling: item.special_handling || existing.special_handling,
                  timestamp: new Date()
                };
              }
              return existing;
            });
          }
        }
      } else if (action === 'remove') {
        // Remove items by name
        const removeNames: string[] = [];
        if (furniture_items) removeNames.push(...furniture_items.map((i: any) => i.name?.toLowerCase()).filter(Boolean));
        if (packed_boxes) removeNames.push(...packed_boxes.map((b: any) => `${b.size} Box`.toLowerCase()));
        if (boxes_needed) removeNames.push(...boxes_needed.map((b: any) => `${b.box_type} needed`.toLowerCase()));

        newInventory = newInventory.filter(i => !removeNames.includes(i.name.toLowerCase()));
      }

      return { ...s, inventory: newInventory };
    });
  }, [saveItemsToDatabase]);

  // Helper function to send frame for analysis
  const sendFrameForAnalysis = useCallback((base64: string) => {
    if (!sessionRef.current) {
      console.error('Gemini Live: No session available for frame analysis');
      waitingForResponseRef.current = false;
      return;
    }

    try {
      sessionRef.current.sendClientContent({
        turns: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: base64 } },
            { text: "Analyze this room for moving inventory. Identify all furniture items, any packed boxes or containers, and estimate boxes needed for loose items. If you see cabinets or closets, assume they contain items needing packing. Call record_inventory with your findings. Be specific and detailed in item names." }
          ]
        }]
      });
    } catch (e) {
      console.error('Gemini Live: Failed to send frame:', e);
      waitingForResponseRef.current = false;
    }
  }, []);

  // Handle messages from Gemini Live
  const handleServerMessage = useCallback((message: LiveServerMessage) => {
    console.log('Gemini Live message:', JSON.stringify(message, null, 2));

    // Handle tool calls (function calls)
    if (message.toolCall?.functionCalls) {
      for (const call of message.toolCall.functionCalls) {
        if (call.name === 'record_inventory') {
          console.log('Gemini Live: Inventory function called', call.args);
          handleInventoryUpdate(call.args);

          // Send tool response
          sessionRef.current?.sendToolResponse({
            functionResponses: [{
              id: call.id,
              name: 'record_inventory',
              response: { status: 'success', message: 'Inventory updated. Continue scanning for more items.' }
            }]
          });
        }
      }
    }

    // Log text responses
    if (message.serverContent?.modelTurn?.parts) {
      for (const part of message.serverContent.modelTurn.parts) {
        if (part.text) {
          console.log('Gemini Live TEXT:', part.text);
        }
        if (part.inlineData) {
          console.log('Gemini Live AUDIO received');
        }
      }
    }

    // Resume frame sending when turn completes
    if (message.serverContent?.turnComplete) {
      console.log('Gemini Live: Turn complete, resuming frame capture');
      waitingForResponseRef.current = false;

      // Immediately analyze latest buffered frame for continuous coverage
      if (latestFrameRef.current && streamingRef.current) {
        setTimeout(() => {
          if (!waitingForResponseRef.current && latestFrameRef.current) {
            console.log('Gemini Live: Analyzing buffered frame immediately after turnComplete');
            waitingForResponseRef.current = true;
            sendFrameForAnalysis(latestFrameRef.current);
          }
        }, 500); // Small delay to avoid hammering the API
      }
    }
  }, [handleInventoryUpdate, sendFrameForAnalysis]);

  // Connect to Gemini Live API using SDK
  const connect = useCallback(async () => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY;
    console.log('Gemini Live: Connect called, API key present:', !!apiKey);

    if (!apiKey) {
      console.error('Gemini Live: No API key found');
      setState(s => ({ ...s, error: 'Missing NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY' }));
      return;
    }

    setState(s => ({ ...s, error: null }));

    try {
      // Initialize the SDK
      const ai = new GoogleGenAI({ apiKey });
      aiRef.current = ai;

      const config = {
        responseModalities: [Modality.AUDIO],
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Puck'
            }
          }
        },
        systemInstruction: `${systemInstruction}

CRITICAL: Wait for video input before reporting any inventory. Call record_inventory when you see rooms, furniture, or storage areas in the video frames.`,
        tools: [{
          functionDeclarations: [inventoryFunctionDeclaration]
        }]
      };

      console.log('Gemini Live: Connecting with SDK...');

      const session = await ai.live.connect({
        model: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            console.log('Gemini Live: Connected');
            setState(s => ({ ...s, isConnected: true, error: null }));
          },
          onmessage: (message: LiveServerMessage) => {
            handleServerMessage(message);
          },
          onerror: (e: ErrorEvent) => {
            console.error('Gemini Live: Error:', e.message);
            setState(s => ({ ...s, error: e.message }));
          },
          onclose: (e: CloseEvent) => {
            console.log('Gemini Live: Closed:', e.reason);
            setState(s => ({ ...s, isConnected: false }));
          }
        },
        config
      });

      sessionRef.current = session;
      console.log('Gemini Live: Session established');

    } catch (error: any) {
      console.error('Gemini Live: Connection failed:', error);
      setState(s => ({ ...s, error: error.message || 'Connection failed' }));
    }
  }, [handleServerMessage, systemInstruction, inventoryFunctionDeclaration]);

  // Start streaming video frames
  const startStreaming = useCallback(async (videoTrack: MediaStreamTrack) => {
    // Connect if not already connected
    if (!sessionRef.current) {
      await connect();
      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (!sessionRef.current) {
      setState(s => ({ ...s, error: 'Failed to connect to Gemini Live' }));
      return;
    }

    // Set up video element
    const video = document.createElement('video');
    video.srcObject = new MediaStream([videoTrack]);
    video.muted = true;
    video.playsInline = true;
    await video.play();
    videoRef.current = video;

    // Set up canvas for frame capture
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    canvasRef.current = canvas;

    streamingRef.current = true;
    setState(s => ({ ...s, isStreaming: true, sessionDuration: 0 }));

    // Start duration timer
    durationIntervalRef.current = setInterval(() => {
      setState(s => ({ ...s, sessionDuration: s.sessionDuration + 1 }));
    }, 1000);

    console.log('Gemini Live: Starting frame capture loop with continuous buffering');

    let frameCount = 0;

    // Frame capture loop - ALWAYS captures to buffer, analyze every 3 seconds
    const captureLoop = () => {
      if (!streamingRef.current) {
        console.log('Gemini Live: Stopping capture loop');
        return;
      }

      if (!sessionRef.current) {
        console.log('Gemini Live: Session not available, skipping frame');
        setTimeout(captureLoop, 1000);
        return;
      }

      const ctx = canvas.getContext('2d');
      if (ctx && video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob((blob) => {
          if (!blob || !streamingRef.current) return;

          const reader = new FileReader();
          reader.onloadend = () => {
            if (!streamingRef.current) return;

            const base64 = (reader.result as string).split(',')[1];
            frameCount++;

            // ALWAYS buffer the latest frame (no gaps in coverage)
            latestFrameRef.current = base64;

            // Only send for analysis when NOT waiting for response
            // AND every 3 seconds (moderate rate for accuracy)
            if (!waitingForResponseRef.current && frameCount % 3 === 0) {
              console.log(`Gemini Live: Sending frame #${frameCount} for analysis (${Math.round(base64.length / 1024)}KB)`);
              waitingForResponseRef.current = true;
              sendFrameForAnalysis(base64);
            } else if (waitingForResponseRef.current) {
              console.log(`Gemini Live: Buffered frame #${frameCount} (waiting for response)`);
            }
          };
          reader.readAsDataURL(blob);
        }, 'image/jpeg', 0.7);
      }

      setTimeout(captureLoop, 1000); // Check every second
    };

    captureLoop();
  }, [connect, sendFrameForAnalysis]);

  // Stop streaming
  const stopStreaming = useCallback(() => {
    console.log('Gemini Live: Stopping streaming');
    streamingRef.current = false;

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }

    setState(s => ({ ...s, isStreaming: false }));
  }, []);

  // Disconnect completely
  const disconnect = useCallback(() => {
    stopStreaming();

    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }

    setState(s => ({
      ...s,
      isConnected: false,
      isStreaming: false
    }));
  }, [stopStreaming]);

  // Clear inventory
  const clearInventory = useCallback(() => {
    setState(s => ({ ...s, inventory: [] }));
  }, []);

  // Get inventory summary for export
  const getInventorySummary = useCallback(() => {
    return state.inventory;
  }, [state.inventory]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamingRef.current = false;
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      if (sessionRef.current) {
        sessionRef.current.close();
      }
    };
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    startStreaming,
    stopStreaming,
    clearInventory,
    getInventorySummary,
  };
}
