using System.Reflection;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Moq;
using UniDipVeri.Application.Abstractions.Models;
using UniDipVeri.Application.Abstractions.Services;
using UniDipVeri.Application.Features.Auth.Models;
using UniDipVeri.Domain.Enums;
using UniDipVeri.WebApi.Controllers;

namespace UniDipVeri.WebApi.Tests.Controllers;

public class StaffControllerTests
{
    private readonly Mock<IAuthService> _authServiceMock = new();
    private readonly StaffController _controller;

    public StaffControllerTests()
    {
        _controller = new StaffController(_authServiceMock.Object);
    }

    [Fact]
    public void StaffController_ShouldHaveRouteAttribute_AndLoginActionShouldHaveHttpPostLogin()
    {
        // Assert controller has ApiController and Route
        typeof(StaffController).GetCustomAttribute<ApiControllerAttribute>().Should().NotBeNull();
        var routeAttr = typeof(StaffController).GetCustomAttribute<RouteAttribute>();
        routeAttr.Should().NotBeNull();
        routeAttr!.Template.Should().Be("api/staffs");

        // Assert Login method has HttpPostAttribute matching login
        var method = typeof(StaffController).GetMethod(nameof(StaffController.Login));
        method.Should().NotBeNull();

        var postAttrs = method!.GetCustomAttributes<HttpPostAttribute>().ToList();
        postAttrs.Should().Contain(a => a.Template == "login");
    }

    [Theory]
    [InlineData(StaffRole.REGISTRAR, "REGISTRAR")]
    [InlineData(StaffRole.APPROVER, "APPROVER")]
    [InlineData(StaffRole.ADMIN, "ADMIN")]
    public async Task Login_ShouldReturn200WithSessionToken_WhenActiveStaffCredentialsAreValid(
        StaffRole role,
        string roleClaim)
    {
        // Arrange
        var request = new LoginRequest($"{role.ToString().ToLower()}@miu.edu", "Password123!");
        var expectedToken = new SessionToken($"token-for-{roleClaim}", DateTime.UtcNow.AddHours(8));
        _authServiceMock.Setup(s => s.AuthenticateStaffAsync(request.Email, request.Password, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AuthResult.Success(expectedToken));

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<OkObjectResult>();
        var okResult = (OkObjectResult)result;
        okResult.StatusCode.Should().Be(200);

        var token = okResult.Value as SessionToken;
        token.Should().NotBeNull();
        token!.Value.Should().Be($"token-for-{roleClaim}");

        _authServiceMock.Verify(s => s.AuthenticateStaffAsync(request.Email, request.Password, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Login_ShouldReturn401_WhenStaffAccountIsInactive()
    {
        // Arrange
        var request = new LoginRequest("inactive@miu.edu", "Password123!");
        _authServiceMock.Setup(s => s.AuthenticateStaffAsync(request.Email, request.Password, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AuthResult.Failure("Invalid email or password."));

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);
    }

    [Fact]
    public async Task Login_ShouldReturn401_WhenPasswordIsIncorrect()
    {
        // Arrange
        var request = new LoginRequest("staff@miu.edu", "WrongPassword!");
        _authServiceMock.Setup(s => s.AuthenticateStaffAsync(request.Email, request.Password, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AuthResult.Failure("Invalid email or password."));

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);
    }

    [Fact]
    public async Task Login_ShouldReturn401_WhenStaffNotFound()
    {
        // Arrange
        var request = new LoginRequest("unknown@miu.edu", "Password123!");
        _authServiceMock.Setup(s => s.AuthenticateStaffAsync(request.Email, request.Password, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AuthResult.Failure("Invalid email or password."));

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);
    }

    [Fact]
    public async Task Login_ShouldReturn401_WhenRequestBodyIsNull()
    {
        // Act
        var result = await _controller.Login(null, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);

        _authServiceMock.Verify(s => s.AuthenticateStaffAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData("", "pass")]
    [InlineData("   ", "pass")]
    [InlineData("staff@miu.edu", "")]
    [InlineData("staff@miu.edu", "   ")]
    public async Task Login_ShouldReturn401_WhenEmailOrPasswordIsEmptyOrWhitespace(string email, string password)
    {
        // Arrange
        var request = new LoginRequest(email, password);

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);

        _authServiceMock.Verify(s => s.AuthenticateStaffAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
