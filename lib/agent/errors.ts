// Never return provider exception objects, request headers or response bodies to the browser.
export function getProviderStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as {
    statusCode?: unknown;
    lastError?: unknown;
    cause?: unknown;
  };
  if (typeof value.statusCode === "number") return value.statusCode;
  if (value.lastError) return getProviderStatus(value.lastError);
  if (value.cause) return getProviderStatus(value.cause);
  return undefined;
}
export function publicAgentError(error: unknown): string {
  const status = getProviderStatus(error);
  if (status === 402)
    return "모델 API가 HTTP 402로 요청을 거절했습니다. API 프로젝트의 결제·선불 크레딧 상태를 확인해 주세요.";
  if (status === 401 || status === 403)
    return "모델 API 인증 또는 접근 권한을 확인해 주세요. 서버의 API 키 설정이 필요합니다.";
  if (status === 429)
    return "모델 API 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.";
  if (
    error instanceof Error &&
    // STEP D gaps (missing tool, unanalysed episode, unsupported search) must
    // reach the operator as-is; a generic retry message would hide them.
    /세션이 만료|다시 선택|설정|관측 도구|현재 범위|조회하지 않은|STEP D/.test(
      error.message,
    )
  )
    return error.message;
  return "작업을 완료하지 못했습니다. 프로그램 범위를 확인하고 다시 시도해 주세요.";
}
