using Microsoft.EntityFrameworkCore;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Infrastructure.Persistence.Repositories;

public class PostgresProgramRepository(UniDipVeriDbContext dbContext) : IProgramRepository
{
    private readonly UniDipVeriDbContext _dbContext = dbContext;

    public async Task<Program?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        return await _dbContext.Programs
            .Include(p => p.University)
            .FirstOrDefaultAsync(p => p.Id == id, ct);
    }

    public async Task<IReadOnlyList<Program>> ListAllAsync(CancellationToken ct = default)
    {
        return await _dbContext.Programs
            .Include(p => p.University)
            .AsNoTracking()
            .OrderBy(p => p.Name)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<Program>> ListByUniversityIdAsync(Guid universityId, CancellationToken ct = default)
    {
        return await _dbContext.Programs
            .Include(p => p.University)
            .AsNoTracking()
            .Where(p => p.UniversityId == universityId)
            .OrderBy(p => p.Name)
            .ToListAsync(ct);
    }

    public async Task<bool> ExistsByNameAsync(Guid universityId, string name, Guid? excludeId = null, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return false;
        }

        var normalizedName = name.Trim().ToLower();
        var query = _dbContext.Programs
            .Where(p => p.UniversityId == universityId && p.Name.ToLower() == normalizedName);

        if (excludeId.HasValue && excludeId.Value != Guid.Empty)
        {
            query = query.Where(p => p.Id != excludeId.Value);
        }

        return await query.AnyAsync(ct);
    }

    public async Task<Guid> GetDefaultUniversityIdAsync(CancellationToken ct = default)
    {
        var id = await _dbContext.Universities.Select(u => u.Id).FirstOrDefaultAsync(ct);
        return id != Guid.Empty ? id : ModelBuilderExtensions.UniversityId;
    }

    public async Task AddAsync(Program program, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(program);
        await _dbContext.Programs.AddAsync(program, ct);
        await _dbContext.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(Program program, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(program);
        _dbContext.Programs.Update(program);
        await _dbContext.SaveChangesAsync(ct);
    }
}
