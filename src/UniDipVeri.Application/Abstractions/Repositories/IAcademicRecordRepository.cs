using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Application.Abstractions.Repositories;

public interface IAcademicRecordRepository
{
    Task<AcademicRecord?> GetByStudentIdAsync(Guid studentId, CancellationToken ct = default);
    Task AddAsync(AcademicRecord record, CancellationToken ct = default);
    Task UpdateAsync(AcademicRecord record, CancellationToken ct = default);
}
