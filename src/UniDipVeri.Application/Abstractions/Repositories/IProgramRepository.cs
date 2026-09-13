using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Application.Abstractions.Repositories;

public interface IProgramRepository
{
    Task<Program?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<Program>> ListAllAsync(CancellationToken ct = default);
    Task<IReadOnlyList<Program>> ListByUniversityIdAsync(Guid universityId, CancellationToken ct = default);
    Task<bool> ExistsByNameAsync(Guid universityId, string name, Guid? excludeId = null, CancellationToken ct = default);
    Task<Guid> GetDefaultUniversityIdAsync(CancellationToken ct = default);
    Task AddAsync(Program program, CancellationToken ct = default);
    Task UpdateAsync(Program program, CancellationToken ct = default);
}
