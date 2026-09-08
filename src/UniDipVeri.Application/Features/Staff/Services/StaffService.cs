using Microsoft.Extensions.Options;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Application.Abstractions.Security;
using UniDipVeri.Application.Configurations;
using UniDipVeri.Application.Features.Staff.Abstractions;
using UniDipVeri.Application.Features.Staff.Models;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Features.Staff.Services;

public class StaffService(
    IStaffRepository staffRepository,
    IPasswordHasher passwordHasher,
    IOptions<ApprovalPolicyOptions> approvalOptions) : IStaffService
{
    private readonly IStaffRepository _staffRepository = staffRepository;
    private readonly IPasswordHasher _passwordHasher = passwordHasher;
    private readonly ApprovalPolicyOptions _approvalOptions = approvalOptions.Value;

    public async Task<StaffResult<StaffResponse>> CreateStaffAsync(CreateStaffRequest request, CancellationToken ct = default)
    {
        if (request is null)
        {
            return StaffResult<StaffResponse>.Validation("Request body cannot be null.");
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return StaffResult<StaffResponse>.Validation("Name is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Email))
        {
            return StaffResult<StaffResponse>.Validation("Email is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Password))
        {
            return StaffResult<StaffResponse>.Validation("Password is required.");
        }

        if (request.Roles is null || request.Roles.Count == 0)
        {
            return StaffResult<StaffResponse>.Validation("At least one staff role must be assigned.");
        }

        var (parsedRoles, roleError) = ParseRoles(request.Roles);
        if (roleError is not null)
        {
            return StaffResult<StaffResponse>.Validation(roleError);
        }

        if (HasForbiddenRoleCombination(parsedRoles))
        {
            return StaffResult<StaffResponse>.PolicyViolation(
                "Assigning both REGISTRAR and APPROVER roles to the same account is prohibited by approval policy.");
        }

        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var existingStaff = await _staffRepository.GetByEmailAsync(normalizedEmail, ct);
        if (existingStaff is not null)
        {
            return StaffResult<StaffResponse>.Conflict("A staff member with this email already exists.");
        }

        var universityId = await _staffRepository.GetDefaultUniversityIdAsync(ct);
        var passwordHash = _passwordHasher.HashPassword(request.Password);

        var staff = UniversityStaff.Create(
            universityId,
            request.Name.Trim(),
            normalizedEmail,
            passwordHash,
            parsedRoles);

        await _staffRepository.AddAsync(staff, ct);

        return StaffResult<StaffResponse>.Success(StaffResponse.FromEntity(staff));
    }

    public async Task<StaffResult<IReadOnlyList<StaffResponse>>> ListStaffAsync(CancellationToken ct = default)
    {
        var staffMembers = await _staffRepository.ListAllAsync(ct);
        var responses = staffMembers.Select(StaffResponse.FromEntity).ToList();
        return StaffResult<IReadOnlyList<StaffResponse>>.Success(responses);
    }

    public async Task<StaffResult<StaffResponse>> GetStaffByIdAsync(Guid id, CancellationToken ct = default)
    {
        var staff = await _staffRepository.GetByIdAsync(id, ct);
        if (staff is null)
        {
            return StaffResult<StaffResponse>.NotFound($"Staff member with ID '{id}' was not found.");
        }

        return StaffResult<StaffResponse>.Success(StaffResponse.FromEntity(staff));
    }

    public async Task<StaffResult<StaffResponse>> UpdateStaffAsync(Guid id, UpdateStaffRequest request, CancellationToken ct = default)
    {
        if (request is null)
        {
            return StaffResult<StaffResponse>.Validation("Request body cannot be null.");
        }

        var staff = await _staffRepository.GetByIdAsync(id, ct);
        if (staff is null)
        {
            return StaffResult<StaffResponse>.NotFound($"Staff member with ID '{id}' was not found.");
        }

        // Email uniqueness check
        if (!string.IsNullOrWhiteSpace(request.Email))
        {
            var normalizedEmail = request.Email.Trim().ToLowerInvariant();
            if (!string.Equals(staff.Email, normalizedEmail, StringComparison.OrdinalIgnoreCase))
            {
                var existingWithEmail = await _staffRepository.GetByEmailAsync(normalizedEmail, ct);
                if (existingWithEmail is not null && existingWithEmail.Id != id)
                {
                    return StaffResult<StaffResponse>.Conflict("A staff member with this email already exists.");
                }
            }
        }

        // Roles update & guards
        if (request.Roles is not null)
        {
            if (request.Roles.Count == 0)
            {
                return StaffResult<StaffResponse>.Validation("At least one staff role must be assigned.");
            }

            var (parsedRoles, roleError) = ParseRoles(request.Roles);
            if (roleError is not null)
            {
                return StaffResult<StaffResponse>.Validation(roleError);
            }

            if (HasForbiddenRoleCombination(parsedRoles))
            {
                return StaffResult<StaffResponse>.PolicyViolation(
                    "Assigning both REGISTRAR and APPROVER roles to the same account is prohibited by approval policy.");
            }

            // Distinct guard: Cannot remove ADMIN role from the last remaining active Admin
            bool isCurrentlyActiveAdmin = staff.IsActive() && staff.HasRole(StaffRole.ADMIN);
            bool isRemovingAdminRole = !parsedRoles.Contains(StaffRole.ADMIN);

            if (isCurrentlyActiveAdmin && isRemovingAdminRole)
            {
                var activeAdminCount = await _staffRepository.CountActiveAdminsAsync(ct);
                if (activeAdminCount <= 1)
                {
                    return StaffResult<StaffResponse>.Conflict(
                        "Cannot remove the ADMIN role from the last remaining active administrator.");
                }
            }

            staff.UpdateRoles(parsedRoles);
        }

        // Profile update (name and/or email)
        var updatedName = !string.IsNullOrWhiteSpace(request.Name) ? request.Name.Trim() : staff.Name;
        var updatedEmail = !string.IsNullOrWhiteSpace(request.Email) ? request.Email.Trim().ToLowerInvariant() : staff.Email;
        staff.UpdateProfile(updatedName, updatedEmail);

        await _staffRepository.UpdateAsync(staff, ct);

        return StaffResult<StaffResponse>.Success(StaffResponse.FromEntity(staff));
    }

    public async Task<StaffResult<StaffResponse>> DeactivateStaffAsync(Guid id, CancellationToken ct = default)
    {
        var staff = await _staffRepository.GetByIdAsync(id, ct);
        if (staff is null)
        {
            return StaffResult<StaffResponse>.NotFound($"Staff member with ID '{id}' was not found.");
        }

        // Guard: Cannot deactivate the last remaining active ADMIN
        if (staff.IsActive() && staff.HasRole(StaffRole.ADMIN))
        {
            var activeAdminCount = await _staffRepository.CountActiveAdminsAsync(ct);
            if (activeAdminCount <= 1)
            {
                return StaffResult<StaffResponse>.Conflict(
                    "Cannot deactivate the last remaining active administrator.");
            }
        }

        staff.Deactivate();
        await _staffRepository.UpdateAsync(staff, ct);

        return StaffResult<StaffResponse>.Success(StaffResponse.FromEntity(staff));
    }

    private bool HasForbiddenRoleCombination(IReadOnlyList<StaffRole> roles)
    {
        if (_approvalOptions.AllowRegistrarApproverCombination)
        {
            return false;
        }

        return roles.Contains(StaffRole.REGISTRAR) && roles.Contains(StaffRole.APPROVER);
    }

    private static (List<StaffRole> Roles, string? Error) ParseRoles(IEnumerable<string> roles)
    {
        var result = new List<StaffRole>();
        foreach (var roleStr in roles)
        {
            if (string.IsNullOrWhiteSpace(roleStr))
            {
                return ([], "Role name cannot be empty.");
            }

            if (!Enum.TryParse<StaffRole>(roleStr.Trim(), ignoreCase: true, out var parsedRole))
            {
                return ([], $"Invalid role: '{roleStr}'. Valid roles are: ADMIN, REGISTRAR, APPROVER.");
            }

            if (!result.Contains(parsedRole))
            {
                result.Add(parsedRole);
            }
        }

        if (result.Count == 0)
        {
            return ([], "At least one valid staff role must be specified.");
        }

        return (result, null);
    }
}
