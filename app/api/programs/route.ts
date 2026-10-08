import { getGateway } from "@/lib/stepd";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    // Program ids are not a fixed enum once STEP D is connected, so the list
    // comes from the gateway.
    const programs = await getGateway().listPrograms();
    if (!programs.length)
      return Response.json(
        { error: "조회할 작품이 없습니다." },
        { status: 503 },
      );
    return Response.json({
      programs,
      mode: programs.every((p) => p.demo) ? "demo" : "connected",
      agent: {
        mode: process.env.AGENT_MODE === "live" ? "live" : "mock",
        provider: process.env.AI_PROVIDER || "google",
        model: process.env.AI_MODEL || "gemini-3.1-flash-lite",
      },
    });
  } catch {
    return Response.json(
      { error: "프로그램 데이터 연결 설정을 확인해 주세요." },
      { status: 503 },
    );
  }
}
