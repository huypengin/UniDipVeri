using UniDipVeri.Application.Abstractions.Models;
using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Application.Abstractions.Repositories;

public interface IStudentRepository
{
    Task<Student?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<Student?> GetByEmailAsync(string email, CancellationToken ct = default);
    Task<Student?> GetByStudentNumberAsync(string studentNumber, CancellationToken ct = default);
    Task<Student?> GetBySourceRecordRefAsync(string sourceRecordRef, CancellationToken ct = default);
    Task<PagedResult<Student>> ListPagedAsync(StudentFilter filter, CancellationToken ct = default);
    Task<IReadOnlyList<Student>> ListAllAsync(CancellationToken ct = default);
    Task AddAsync(Student student, CancellationToken ct = default);
    Task UpdateAsync(Student student, CancellationToken ct = default);
}
