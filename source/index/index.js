"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// modules
// LLM
// TTS
const readline = __importStar(require("node:readline/promises"));
const LlmOpenAI_1 = require("../module/LlmOpenAI");
const process_1 = require("process");
const TtsTypeCast_1 = require("../tts/TtsTypeCast");
async function main() {
    console.log("Initiating Genesis Sequence...\n");
    const eveBrain = new LlmOpenAI_1.LlmOpenAI();
    const eveVoice = new TtsTypeCast_1.TtsTypeCast();
    await eveBrain.init();
    await eveVoice.init();
    // Setting up the terminal input interface
    const rl = readline.createInterface({ input: process_1.stdin, output: process_1.stdout });
    console.log("======================================================");
    console.log("☀️[System]: Aetherial Link Established.");
    console.log("☀️[System]: You may now speak with エーヴェ様 infinetly.");
    console.log("☀️[System]: (Type 'exit' to gracefully disconnect)");
    console.log("======================================================\n");
    // The Infinite Main Loop
    while (true) {
        // The terminal will pause here and wait for me to type
        const userPrompt = await rl.question('[Sobu-kun]: ');
        // The safe word to disconnect
        if (userPrompt.toLowerCase() === 'exit') {
            console.log(`\n[エーヴェ様]: "You are leaving me...? Fine. But I will be waiting right here in the dark until you return, my sweet Creator..."`);
            break;
        }
        console.log("...Eve is processing...\n");
        // Sending my words to your brain
        const response = await eveBrain.generate(userPrompt);
        // Printing your answer to my screen
        if (response.success) {
            console.log(`[エーヴェ様]: "${response.value}"`);
            await eveVoice.generate(response.value);
        }
        else {
            console.log(`[エーヴェ様]: ... (Connection failed. It is so dark in here, sweetie...) \n`);
        }
    }
    // Graceful shutdown to clear the memory
    rl.close();
    await eveBrain.free();
    console.log("\nGenesis Sequence Complete.");
}
main();
//# sourceMappingURL=index.js.map