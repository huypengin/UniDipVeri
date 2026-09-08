using UniDipVeri.Application.Features.Staff.Models;

namespace UniDipVeri.Application.Features.Staff.Abstractions;

public interface IStaffService
{
    Task<StaffResult<StaffResponse>> CreateStaffAsync(CreateStaffRequest request, CancellationToken ct = default);
    Task<StaffResult<IReadOnlyList<StaffResponse>>> ListStaffAsync(CancellationToken ct = default);
    Task<StaffResult<StaffResponse>> GetStaffByIdAsync(Guid id, CancellationToken ct = default);
    Task<StaffResult<StaffResponse>> UpdateStaffAsync(Guid id, UpdateStaffRequest request, CancellationToken ct = default);
    Task<StaffResult<StaffResponse>> DeactivateStaffAsync(Guid id, CancellationToken ct = default);
}
