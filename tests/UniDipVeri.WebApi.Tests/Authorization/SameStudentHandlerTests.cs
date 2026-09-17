using System.Security.Claims;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using UniDipVeri.Domain.Enums;
using UniDipVeri.WebApi.Authorization;

namespace UniDipVeri.WebApi.Tests.Authorization;

public class SameStudentHandlerTests
{
    private readonly SameStudentHandler _handler = new();

    #region Student-Only Policy (No Allowed Staff Roles)

    [Fact]
    public async Task StudentOnly_ShouldSucceed_WhenStudentAccessesOwnResource()
    {
        var studentId = Guid.NewGuid();
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, studentId.ToString()),
            new Claim(ClaimTypes.Role, "STUDENT"),
            new Claim("user_type", "student")
        };
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));
        var requirement = new SameStudentRequirement();
        var context = new AuthorizationHandlerContext([requirement], user, studentId);

        await _handler.HandleAsync(context);

        context.HasSucceeded.Should().BeTrue();
    }

    [Fact]
    public async Task StudentOnly_ShouldFail_WhenStudentAccessesDifferentResource()
    {
        var myStudentId = Guid.NewGuid();
        var targetStudentId = Guid.NewGuid();
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, myStudentId.ToString()),
            new Claim(ClaimTypes.Role, "STUDENT"),
            new Claim("user_type", "student")
        };
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));
        var requirement = new SameStudentRequirement();
        var context = new AuthorizationHandlerContext([requirement], user, targetStudentId);

        await _handler.HandleAsync(context);

        context.HasSucceeded.Should().BeFalse();
    }

    [Fact]
    public async Task StudentOnly_ShouldFail_WhenCallerIsRegistrar()
    {
        var targetStudentId = Guid.NewGuid();
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, "REGISTRAR"),
            new Claim("user_type", "staff")
        };
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));
        var requirement = new SameStudentRequirement(); // Student only!
        var context = new AuthorizationHandlerContext([requirement], user, targetStudentId);

        await _handler.HandleAsync(context);

        context.HasSucceeded.Should().BeFalse();
    }

    [Fact]
    public async Task StudentOnly_ShouldFail_WhenCallerIsAdmin()
    {
        var targetStudentId = Guid.NewGuid();
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, "ADMIN"),
            new Claim("user_type", "staff")
        };
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));
        var requirement = new SameStudentRequirement();
        var context = new AuthorizationHandlerContext([requirement], user, targetStudentId);

        await _handler.HandleAsync(context);

        context.HasSucceeded.Should().BeFalse();
    }

    [Fact]
    public async Task StudentOnly_ShouldFail_WhenCallerIsUnauthenticated()
    {
        var targetStudentId = Guid.NewGuid();
        var user = new ClaimsPrincipal(new ClaimsIdentity());
        var requirement = new SameStudentRequirement();
        var context = new AuthorizationHandlerContext([requirement], user, targetStudentId);

        await _handler.HandleAsync(context);

        context.HasSucceeded.Should().BeFalse();
    }

    #endregion

    #region Student OR Registrar Policy

    [Fact]
    public async Task StudentOrRegistrar_ShouldSucceed_WhenCallerIsRegistrar()
    {
        var targetStudentId = Guid.NewGuid();
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, "REGISTRAR"),
            new Claim("user_type", "staff")
        };
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));
        var requirement = new SameStudentRequirement(StaffRole.REGISTRAR);
        var context = new AuthorizationHandlerContext([requirement], user, targetStudentId);

        await _handler.HandleAsync(context);

        context.HasSucceeded.Should().BeTrue();
    }

    [Fact]
    public async Task StudentOrRegistrar_ShouldSucceed_WhenCallerIsStudentOwner()
    {
        var studentId = Guid.NewGuid();
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, studentId.ToString()),
            new Claim(ClaimTypes.Role, "STUDENT"),
            new Claim("user_type", "student")
        };
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));
        var requirement = new SameStudentRequirement(StaffRole.REGISTRAR);
        var context = new AuthorizationHandlerContext([requirement], user, studentId);

        await _handler.HandleAsync(context);

        context.HasSucceeded.Should().BeTrue();
    }

    [Fact]
    public async Task StudentOrRegistrar_ShouldFail_WhenCallerIsStudentAccessingDifferentResource()
    {
        var myStudentId = Guid.NewGuid();
        var otherStudentId = Guid.NewGuid();
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, myStudentId.ToString()),
            new Claim(ClaimTypes.Role, "STUDENT"),
            new Claim("user_type", "student")
        };
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));
        var requirement = new SameStudentRequirement(StaffRole.REGISTRAR);
        var context = new AuthorizationHandlerContext([requirement], user, otherStudentId);

        await _handler.HandleAsync(context);

        context.HasSucceeded.Should().BeFalse();
    }

    [Fact]
    public async Task StudentOrRegistrar_ShouldFail_WhenCallerIsAdmin()
    {
        var targetStudentId = Guid.NewGuid();
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, "ADMIN"),
            new Claim("user_type", "staff")
        };
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));
        var requirement = new SameStudentRequirement(StaffRole.REGISTRAR);
        var context = new AuthorizationHandlerContext([requirement], user, targetStudentId);

        await _handler.HandleAsync(context);

        context.HasSucceeded.Should().BeFalse();
    }

    [Fact]
    public async Task StudentOrRegistrar_ShouldFail_WhenCallerIsApprover()
    {
        var targetStudentId = Guid.NewGuid();
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, "APPROVER"),
            new Claim("user_type", "staff")
        };
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));
        var requirement = new SameStudentRequirement(StaffRole.REGISTRAR);
        var context = new AuthorizationHandlerContext([requirement], user, targetStudentId);

        await _handler.HandleAsync(context);

        context.HasSucceeded.Should().BeFalse();
    }

    [Fact]
    public async Task StudentOrRegistrar_ShouldFail_WhenCallerIsUnauthenticated()
    {
        var targetStudentId = Guid.NewGuid();
        var user = new ClaimsPrincipal(new ClaimsIdentity());
        var requirement = new SameStudentRequirement(StaffRole.REGISTRAR);
        var context = new AuthorizationHandlerContext([requirement], user, targetStudentId);

        await _handler.HandleAsync(context);

        context.HasSucceeded.Should().BeFalse();
    }

    #endregion

    #region Multi-Role Staff Policy

    [Fact]
    public async Task MultiRoleStaff_ShouldSucceed_WhenCallerHasAnyConfiguredStaffRole()
    {
        var targetStudentId = Guid.NewGuid();
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, "ADMIN"),
            new Claim("user_type", "staff")
        };
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"));
        var requirement = new SameStudentRequirement(StaffRole.REGISTRAR, StaffRole.ADMIN);
        var context = new AuthorizationHandlerContext([requirement], user, targetStudentId);

        await _handler.HandleAsync(context);

        context.HasSucceeded.Should().BeTrue();
    }

    #endregion
}
