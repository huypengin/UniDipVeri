using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;

namespace UniDipVeri.WebApi.Authorization;

public class SameStudentHandler : AuthorizationHandler<SameStudentRequirement, Guid>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        SameStudentRequirement requirement,
        Guid studentId)
    {
        var user = context.User;
        if (user.Identity is null || !user.Identity.IsAuthenticated)
        {
            return Task.CompletedTask;
        }

        var isStudent = user.IsInRole("STUDENT") ||
                        string.Equals(user.FindFirstValue("user_type"), "STUDENT", StringComparison.OrdinalIgnoreCase);

        // 1. Check if caller is the student owner of the resource
        if (isStudent)
        {
            var currentUserId = user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (string.Equals(currentUserId, studentId.ToString(), StringComparison.OrdinalIgnoreCase))
            {
                context.Succeed(requirement);
                return Task.CompletedTask;
            }
        }

        // 2. Check if caller has an allowed staff role (and is not a student)
        if (requirement.AllowedStaffRoles.Count > 0 && !isStudent)
        {
            var userRoles = user.FindAll(c => c.Type == ClaimTypes.Role || c.Type == "role")
                .Select(c => c.Value);

            var hasAllowedStaffRole = requirement.AllowedStaffRoles.Any(r =>
                user.IsInRole(r.ToString()) ||
                userRoles.Any(ur => string.Equals(ur, r.ToString(), StringComparison.OrdinalIgnoreCase)));

            if (hasAllowedStaffRole)
            {
                context.Succeed(requirement);
            }
        }

        return Task.CompletedTask;
    }
}
