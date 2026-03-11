package checker_test

import (
	"context"
	"testing"

	"github.com/microsoft/typescript-go/internal/bundled"
	"github.com/microsoft/typescript-go/internal/compiler"
	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/tsoptions"
	"github.com/microsoft/typescript-go/internal/vfs/osvfs"
	"github.com/microsoft/typescript-go/internal/vfs/vfstest"
)

var stableCFABenchmarkDiagCount int

const stableCFARepeatedReadsBenchmarkSource = `
declare const read: stable () => string | undefined;

export function repeatedReads(): number {
    let total = 0;
    if (read() !== undefined) {
        total += read().length;
        total += read().length;
        total += read().length;
    }
    return total;
}
`

const stableCFAUncertaintyBoundaryBenchmarkSource = `
declare const read: stable () => string | undefined;
declare function unknownMutate(): void;

export function uncertaintyBoundary(): void {
    if (read() !== undefined) {
        unknownMutate();
        read();
    }
}
`

func BenchmarkStableCFAFlow(b *testing.B) {
	b.Run("RepeatedReads", func(b *testing.B) {
		benchmarkStableCFASemanticDiagnostics(b, stableCFARepeatedReadsBenchmarkSource)
	})

	b.Run("UncertaintyBoundary", func(b *testing.B) {
		benchmarkStableCFASemanticDiagnostics(b, stableCFAUncertaintyBoundaryBenchmarkSource)
	})
}

func benchmarkStableCFASemanticDiagnostics(b *testing.B, sourceText string) {
	ctx := context.Background()
	const sourceFileName = "/bench.ts"

	compilerOptions := core.CompilerOptions{
		Strict: core.TSTrue,
	}

	programOptions := compiler.ProgramOptions{
		Config: &tsoptions.ParsedCommandLine{
			ParsedConfig: &core.ParsedOptions{
				FileNames:       []string{sourceFileName},
				CompilerOptions: &compilerOptions,
			},
		},
		Host: compiler.NewCompilerHost(
			"/",
			bundled.WrapFS(vfstest.FromMap(map[string]string{sourceFileName: sourceText}, osvfs.FS().UseCaseSensitiveFileNames())),
			bundled.LibPath(),
			nil,
			nil,
		),
	}

	warmProgram := compiler.NewProgram(programOptions)
	warmDiags := warmProgram.GetSemanticDiagnostics(ctx, warmProgram.GetSourceFile(sourceFileName))
	stableCFABenchmarkDiagCount = len(warmDiags)

	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		program := compiler.NewProgram(programOptions)
		diags := program.GetSemanticDiagnostics(ctx, program.GetSourceFile(sourceFileName))
		stableCFABenchmarkDiagCount = len(diags)
	}
}
