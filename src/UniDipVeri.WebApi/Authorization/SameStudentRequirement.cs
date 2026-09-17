using Microsoft.AspNetCore.Authorization;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.WebApi.Authorization;

public class SameStudentRequirement : IAuthorizationRequirement
{
    public IReadOnlyList<StaffRole> AllowedStaffRoles { get; }

    public SameStudentRequirement(params StaffRole[] allowedStaffRoles)
    {
        AllowedStaffRoles = allowedStaffRoles ?? [];
    }
}
