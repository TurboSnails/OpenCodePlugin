import { homedir } from "os"

export interface DoctorContext {
  cwd: string
  homeDir: string
  pathEnv: string
  configPath?: string
}

export function makeContext(overrides: Partial<DoctorContext> = {}): DoctorContext {
  return {
    cwd: process.cwd(),
    homeDir: homedir(),
    pathEnv: process.env.PATH ?? "",
    ...overrides,
  }
}
