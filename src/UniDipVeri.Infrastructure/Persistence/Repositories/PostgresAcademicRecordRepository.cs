using Microsoft.EntityFrameworkCore;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Infrastructure.Persistence.Repositories;

public class PostgresAcademicRecordRepository(UniDipVeriDbContext dbContext) : IAcademicRecordRepository
{
    private readonly UniDipVeriDbContext _dbContext = dbContext;

    public async Task<AcademicRecord?> GetByStudentIdAsync(Guid studentId, CancellationToken ct = default)
    {
        if (studentId == Guid.Empty)
        {
            return null;
        }

        return await _dbContext.AcademicRecords
            .Include(ar => ar.Student)
            .FirstOrDefaultAsync(ar => ar.StudentId == studentId, ct);
    }

    public async Task AddAsync(AcademicRecord record, CancellationToken ct = default)
    {
        await _dbContext.AcademicRecords.AddAsync(record, ct);
        await _dbContext.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(AcademicRecord record, CancellationToken ct = default)
    {
        _dbContext.AcademicRecords.Update(record);
        await _dbContext.SaveChangesAsync(ct);
    }
}
