import type { ParserName } from "./config";
export type ParsedLine = {
    progressText?: string;
    finalText?: string;
    externalId?: string;
};
export type LineParser = (line: string) => ParsedLine;
export declare function getParser(name: ParserName): LineParser;
//# sourceMappingURL=parse-events.d.ts.map