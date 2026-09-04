using Microsoft.EntityFrameworkCore;
using UniDipVeri.Application.Abstractions.Models;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Infrastructure.Persistence.Repositories;

public class PostgresStudentRepository(UniDipVeriDbContext dbContext) : IStudentRepository
{
    private readonly UniDipVeriDbContext _dbContext = dbContext;

    public async Task<Student?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        return await _dbContext.Students
            .Include(s => s.Program)
            .FirstOrDefaultAsync(s => s.Id == id, ct);
    }

    public async Task<Student?> GetByEmailAsync(string email, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return null;
        }

        var normalizedEmail = email.Trim().ToLower();
        return await _dbContext.Students
            .Include(s => s.Program)
            .FirstOrDefaultAsync(s => s.Email.ToLower() == normalizedEmail, ct);
    }

    public async Task<Student?> GetByStudentNumberAsync(string studentNumber, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(studentNumber))
        {
            return null;
        }

        var normalizedNumber = studentNumber.Trim();
        return await _dbContext.Students
            .Include(s => s.Program)
            .FirstOrDefaultAsync(s => s.StudentNumber == normalizedNumber, ct);
    }

    public async Task<Student?> GetBySourceRecordRefAsync(string sourceRecordRef, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sourceRecordRef))
        {
            return null;
        }

        var normalizedRef = sourceRecordRef.Trim();
        return await _dbContext.Students
            .Include(s => s.Program)
            .FirstOrDefaultAsync(s => s.SourceRecordRef == normalizedRef, ct);
    }

    public async Task<PagedResult<Student>> ListPagedAsync(StudentFilter filter, CancellationToken ct = default)
    {
        var query = _dbContext.Students
            .Include(s => s.Program)
            .AsNoTracking()
            .AsQueryable();

        if (filter.ProgramId.HasValue)
        {
            query = query.Where(s => s.ProgramId == filter.ProgramId.Value);
        }

        if (filter.AccountStatus.HasValue)
        {
            query = query.Where(s => s.AccountStatus == filter.AccountStatus.Value);
        }

        if (filter.GraduationStatus.HasValue)
        {
            query = query.Where(s => s.GraduationStatus == filter.GraduationStatus.Value);
        }

        if (filter.WalletStatus.HasValue)
        {
            query = query.Where(s => s.WalletStatus == filter.WalletStatus.Value);
        }

        if (!string.IsNullOrWhiteSpace(filter.SearchTerm))
        {
            var term = filter.SearchTerm.Trim().ToLower();
            query = query.Where(s => s.Name.ToLower().Contains(term) ||
                                     s.StudentNumber.ToLower().Contains(term) ||
                                     s.Email.ToLower().Contains(term));
        }

        var totalCount = await query.CountAsync(ct);

        var page = filter.Page < 1 ? 1 : filter.Page;
        var pageSize = filter.PageSize < 1 ? 20 : filter.PageSize;

        var items = await query
            .OrderBy(s => s.StudentNumber)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        return new PagedResult<Student>(items, totalCount, page, pageSize);
    }

    public async Task<IReadOnlyList<Student>> ListAllAsync(CancellationToken ct = default)
    {
        return await _dbContext.Students
            .Include(s => s.Program)
            .AsNoTracking()
            .OrderBy(s => s.StudentNumber)
            .ToListAsync(ct);
    }

    public async Task AddAsync(Student student, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(student);
        await _dbContext.Students.AddAsync(student, ct);
        await _dbContext.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(Student student, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(student);
        _dbContext.Students.Update(student);
        await _dbContext.SaveChangesAsync(ct);
    }
}
