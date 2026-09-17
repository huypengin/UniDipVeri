using System.Reflection;
using System.Security.Claims;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using UniDipVeri.Application.Features.AcademicRecords.Abstractions;
using UniDipVeri.Application.Features.AcademicRecords.Models;
using UniDipVeri.Domain.Enums;
using UniDipVeri.WebApi.Authorization;
using UniDipVeri.WebApi.Controllers;

namespace UniDipVeri.WebApi.Tests.Controllers;

public class AcademicRecordControllerTests
{
    private readonly Mock<IAcademicRecordService> _serviceMock = new();
    private readonly Mock<IAuthorizationService> _authorizationServiceMock = new();
    private readonly AcademicRecordController _controller;

    public AcademicRecordControllerTests()
    {
        var handler = new SameStudentHandler();

        _authorizationServiceMock
            .Setup(a => a.AuthorizeAsync(
                It.IsAny<ClaimsPrincipal>(),
                It.IsAny<object?>(),
                AuthorizationPolicies.SameStudentOrRegistrar))
            .Returns<ClaimsPrincipal, object?, string>(async (user, resource, _) =>
            {
                if (resource is Guid studentId)
                {
                    var req = new SameStudentRequirement(StaffRole.REGISTRAR);
                    var context = new AuthorizationHandlerContext([req], user, studentId);
                    await handler.HandleAsync(context);
                    return context.HasSucceeded ? AuthorizationResult.Success() : AuthorizationResult.Failed();
                }
                return AuthorizationResult.Failed();
            });

        _controller = new AcademicRecordController(_serviceMock.Object, _authorizationServiceMock.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
        };
    }

    private void SetStaffUser(params StaffRole[] roles)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new("user_type", "staff")
        };
        foreach (var role in roles)
        {
            claims.Add(new Claim(ClaimTypes.Role, role.ToString()));
        }

        var identity = new ClaimsIdentity(claims, "TestAuth");
        _controller.ControllerContext.HttpContext.User = new ClaimsPrincipal(identity);
    }

    private void SetStudentUser(Guid studentId)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, studentId.ToString()),
            new(ClaimTypes.Role, "STUDENT"),
            new("user_type", "STUDENT")
        };

        var identity = new ClaimsIdentity(claims, "TestAuth");
        _controller.ControllerContext.HttpContext.User = new ClaimsPrincipal(identity);
    }

    private void SetUnauthenticatedUser()
    {
        _controller.ControllerContext.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity());
    }

    #region Authorization Tests

    [Fact]
    public void ImportRecord_ShouldHaveAuthorizeAttribute_RequiringRegistrarRole()
    {
        var method = typeof(AcademicRecordController).GetMethod(nameof(AcademicRecordController.ImportRecord));
        method.Should().NotBeNull();
        var authAttr = method!.GetCustomAttribute<AuthorizeAttribute>();
        authAttr.Should().NotBeNull();
        authAttr!.Roles.Should().Be("REGISTRAR");
    }

    [Fact]
    public void GetRecordByStudentId_ShouldHaveAuthorizeAttribute()
    {
        var method = typeof(AcademicRecordController).GetMethod(nameof(AcademicRecordController.GetRecordByStudentId));
        method.Should().NotBeNull();
        var authAttr = method!.GetCustomAttribute<AuthorizeAttribute>();
        authAttr.Should().NotBeNull();
    }

    [Fact]
    public async Task GetRecordByStudentId_ShouldReturnForbidden_WhenUserIsAdmin()
    {
        SetStaffUser(StaffRole.ADMIN);

        var result = await _controller.GetRecordByStudentId(Guid.NewGuid());

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
    }

    [Fact]
    public async Task GetRecordByStudentId_ShouldReturnForbidden_WhenStudentAccessesAnotherStudent()
    {
        var myStudentId = Guid.NewGuid();
        var anotherStudentId = Guid.NewGuid();
        SetStudentUser(myStudentId);

        var result = await _controller.GetRecordByStudentId(anotherStudentId);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
    }

    [Fact]
    public async Task GetRecordByStudentId_ShouldAllowAccess_WhenStudentAccessesOwnRecord()
    {
        var myStudentId = Guid.NewGuid();
        SetStudentUser(myStudentId);

        var recordResponse = new AcademicRecordResponse
        {
            Id = Guid.NewGuid(),
            StudentId = myStudentId,
            CreditsCompleted = 120,
            Gpa = 3.5m,
            CompletedCourses = ["CS101"],
            SourceSnapshotAt = DateTime.UtcNow,
            ImportedAt = DateTime.UtcNow
        };

        _serviceMock.Setup(s => s.GetRecordByStudentIdAsync(myStudentId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AcademicRecordResult<AcademicRecordResponse>.Success(recordResponse));

        var result = await _controller.GetRecordByStudentId(myStudentId);

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.StatusCode.Should().Be(StatusCodes.Status200OK);
    }

    [Fact]
    public async Task GetRecordByStudentId_ShouldAllowAccess_WhenUserIsRegistrar()
    {
        SetStaffUser(StaffRole.REGISTRAR);
        var targetStudentId = Guid.NewGuid();

        var recordResponse = new AcademicRecordResponse
        {
            Id = Guid.NewGuid(),
            StudentId = targetStudentId,
            CreditsCompleted = 120,
            Gpa = 3.5m,
            CompletedCourses = ["CS101"],
            SourceSnapshotAt = DateTime.UtcNow,
            ImportedAt = DateTime.UtcNow
        };

        _serviceMock.Setup(s => s.GetRecordByStudentIdAsync(targetStudentId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AcademicRecordResult<AcademicRecordResponse>.Success(recordResponse));

        var result = await _controller.GetRecordByStudentId(targetStudentId);

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.StatusCode.Should().Be(StatusCodes.Status200OK);
    }

    #endregion

    #region Action Logic Tests

    [Fact]
    public async Task ImportRecord_ShouldReturnBadRequest_WhenRequestIsNull()
    {
        SetStaffUser(StaffRole.REGISTRAR);

        var result = await _controller.ImportRecord(null);

        var badRequest = result.Should().BeOfType<BadRequestObjectResult>().Subject;
        badRequest.StatusCode.Should().Be(StatusCodes.Status400BadRequest);
    }

    [Fact]
    public async Task ImportRecord_ShouldReturn201Created_WhenNewStudentImported()
    {
        SetStaffUser(StaffRole.REGISTRAR);
        var studentId = Guid.NewGuid();
        var request = new ImportAcademicRecordRequest
        {
            StudentNumber = "MIU2026-001",
            Name = "John",
            Email = "john@miu.edu",
            ProgramId = Guid.NewGuid(),
            CreditsCompleted = 120,
            Gpa = 3.5m,
            CompletedCourses = ["CS101"],
            SourceRecordRef = "SRC-1"
        };

        var response = new ImportResultResponse
        {
            StudentId = studentId,
            StudentNumber = "MIU2026-001",
            Name = "John",
            Email = "john@miu.edu",
            AccountStatus = "PENDING_ACTIVATION",
            WalletStatus = "PENDING",
            IsNewStudent = true,
            AcademicRecord = new AcademicRecordResponse
            {
                Id = Guid.NewGuid(),
                StudentId = studentId,
                CreditsCompleted = 120,
                Gpa = 3.5m,
                CompletedCourses = ["CS101"]
            }
        };

        _serviceMock.Setup(s => s.ImportRecordAsync(request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AcademicRecordResult<ImportResultResponse>.Success(response));

        var result = await _controller.ImportRecord(request);

        var createdResult = result.Should().BeOfType<CreatedAtActionResult>().Subject;
        createdResult.StatusCode.Should().Be(StatusCodes.Status201Created);
        createdResult.ActionName.Should().Be(nameof(AcademicRecordController.GetRecordByStudentId));
        createdResult.RouteValues!["studentId"].Should().Be(studentId);
    }

    [Fact]
    public async Task ImportRecord_ShouldReturn200Ok_WhenExistingStudentUpdated()
    {
        SetStaffUser(StaffRole.REGISTRAR);
        var studentId = Guid.NewGuid();
        var request = new ImportAcademicRecordRequest
        {
            StudentNumber = "MIU2026-001",
            Name = "John Updated",
            Email = "john@miu.edu",
            ProgramId = Guid.NewGuid(),
            CreditsCompleted = 120,
            Gpa = 3.5m,
            CompletedCourses = ["CS101"],
            SourceRecordRef = "SRC-1"
        };

        var response = new ImportResultResponse
        {
            StudentId = studentId,
            StudentNumber = "MIU2026-001",
            Name = "John Updated",
            Email = "john@miu.edu",
            AccountStatus = "ACTIVE",
            WalletStatus = "ACTIVE",
            IsNewStudent = false,
            AcademicRecord = new AcademicRecordResponse
            {
                Id = Guid.NewGuid(),
                StudentId = studentId,
                CreditsCompleted = 120,
                Gpa = 3.5m,
                CompletedCourses = ["CS101"]
            }
        };

        _serviceMock.Setup(s => s.ImportRecordAsync(request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AcademicRecordResult<ImportResultResponse>.Success(response));

        var result = await _controller.ImportRecord(request);

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.StatusCode.Should().Be(StatusCodes.Status200OK);
    }

    [Fact]
    public async Task ImportRecord_ShouldReturn400BadRequest_WhenValidationFails()
    {
        SetStaffUser(StaffRole.REGISTRAR);
        var request = new ImportAcademicRecordRequest();

        _serviceMock.Setup(s => s.ImportRecordAsync(request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AcademicRecordResult<ImportResultResponse>.Validation("Invalid program."));

        var result = await _controller.ImportRecord(request);

        var badRequest = result.Should().BeOfType<BadRequestObjectResult>().Subject;
        badRequest.StatusCode.Should().Be(StatusCodes.Status400BadRequest);
    }

    [Fact]
    public async Task ImportRecord_ShouldReturn409Conflict_WhenConflictOccurs()
    {
        SetStaffUser(StaffRole.REGISTRAR);
        var request = new ImportAcademicRecordRequest();

        _serviceMock.Setup(s => s.ImportRecordAsync(request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AcademicRecordResult<ImportResultResponse>.Conflict("Student number already registered."));

        var result = await _controller.ImportRecord(request);

        var conflict = result.Should().BeOfType<ConflictObjectResult>().Subject;
        conflict.StatusCode.Should().Be(StatusCodes.Status409Conflict);
    }

    [Fact]
    public async Task GetRecordByStudentId_ShouldReturn404NotFound_WhenRecordNotFound()
    {
        SetStaffUser(StaffRole.REGISTRAR);
        var studentId = Guid.NewGuid();

        _serviceMock.Setup(s => s.GetRecordByStudentIdAsync(studentId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AcademicRecordResult<AcademicRecordResponse>.NotFound("Record not found."));

        var result = await _controller.GetRecordByStudentId(studentId);

        var notFound = result.Should().BeOfType<NotFoundObjectResult>().Subject;
        notFound.StatusCode.Should().Be(StatusCodes.Status404NotFound);
    }

    #endregion
}
