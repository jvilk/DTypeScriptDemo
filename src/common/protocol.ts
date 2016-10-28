export interface ErrorResponse {
  type: 'error';
  msg: string;
}
export interface Position {
  position: number;
  line: number;
  character: number;
}
export interface DiagnosticError {
  fileName: string;
  startPos: Position;
  endPos: Position;
  msg: string;
}
export interface DiagnosticResponse {
  type: 'diagnostic';
  errors: DiagnosticError[];
}
export interface CompilationResponse extends File {
  type: 'compilation';
}
export interface File {
  src: string;
  map: string;
}
export interface InternalErrorResponse {
  type: 'internal-error';
  msg: string;
  stack: string;
}
export interface BadRequestResponse {
  type: 'bad-request';
  msg: string;
}
export interface HeartBeatResponse {
  type: 'heartbeat'
}
export type Response = ErrorResponse | CompilationResponse | DiagnosticResponse | InternalErrorResponse | BadRequestResponse | HeartBeatResponse;
