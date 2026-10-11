import { createLiveHandlers } from "../../../../server/live/handlers";
import { runtime as liveRuntime } from "../_lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handlers = createLiveHandlers(liveRuntime);
export const POST = handlers.POST;
