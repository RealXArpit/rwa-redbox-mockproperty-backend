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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_server_1 = require("@hono/node-server");
const hono_1 = require("hono");
const cors_1 = require("hono/cors");
require("dotenv/config");
const upload_1 = __importDefault(require("./routes/redbox/upload"));
const submit_1 = __importDefault(require("./routes/redbox/submit"));
const app = new hono_1.Hono();
app.use("/*", (0, cors_1.cors)({
    origin: ["http://localhost:5173", "https://rwaREDbox.com"],
}));
app.get("/", (c) => c.json({ status: "RealX Redbox backend is running" }));
app.route("/api/redbox", upload_1.default);
app.route("/api/redbox", submit_1.default);
app.get("/test-db", async (c) => {
    const { createClient } = await Promise.resolve().then(() => __importStar(require("@supabase/supabase-js")));
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    console.log("URL:", process.env.SUPABASE_URL);
    console.log("KEY prefix:", process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 10));
    const { data, error } = await supabase
        .from("property_submissions")
        .insert({ property_name: "Test", status: "draft" })
        .select("id")
        .single();
    if (error) {
        return c.json({
            error: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
        });
    }
    return c.json({ success: true, id: data.id });
});
(0, node_server_1.serve)({
    fetch: app.fetch,
    port: Number(process.env.PORT) || 3000,
}, (info) => {
    console.log(`Backend running at http://localhost:${info.port}`);
});
