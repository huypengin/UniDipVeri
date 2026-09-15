using UniDipVeri.Application.Features.AcademicRecords.Models;

namespace UniDipVeri.Application.Features.AcademicRecords.Abstractions;

public interface IAcademicRecordService
{
    Task<AcademicRecordResult<ImportResultResponse>> ImportRecordAsync(ImportAcademicRecordRequest request, CancellationToken ct = default);

    Task<AcademicRecordResult<AcademicRecordResponse>> GetRecordByStudentIdAsync(Guid studentId, CancellationToken ct = default);
}
