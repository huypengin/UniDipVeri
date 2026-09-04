using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Application.Abstractions.Repositories;

public interface IStaffRepository
{
    Task<UniversityStaff?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<UniversityStaff?> GetByEmailAsync(string email, CancellationToken ct = default);
    Task<int> CountActiveAdminsAsync(CancellationToken ct = default);
    Task<IReadOnlyList<UniversityStaff>> ListAllAsync(CancellationToken ct = default);
    Task AddAsync(UniversityStaff staff, CancellationToken ct = default);
    Task UpdateAsync(UniversityStaff staff, CancellationToken ct = default);
}
